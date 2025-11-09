const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth");
const { logOrderEvent } = require("./utils");

/**
 * UPDATE ORDER STATUS
 * Seller or admin can update order status (confirmed, shipped, delivered, cancelled)
 * Buyers can view order progress but not change it (except for cancelling under some conditions).
 */
exports.updateOrderStatus = onRequest(async (request, response) => {
  try {
    // Only allow PATCH or POST requests for safety and clarity
    if (request.method !== "PATCH" && request.method !== "POST") {
      return response.status(405).json({ error: "Use PATCH or POST method" });
    }

    // Extract main request fields
    const { orderId, status, notes, proofOfDelivery, trackingNumber, trackingProvider } = request.body;

    // Validate required fields
    if (!orderId || !status) {
      return response.status(400).json({ error: "Missing required fields: orderId and status" });
    }

    // Define valid statuses to prevent invalid transitions
    const validStatuses = ["pending", "confirmed", "shipped", "delivered", "cancelled", "refunded"];
    if (!validStatuses.includes(status)) {
      return response.status(400).json({ error: "Invalid order status" });
    }

    // Verify user (seller or admin)
    const { uid: userId, user: userData } = await verifyUser(request);

    // Get order document from Firestore
    const orderRef = admin.firestore().collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    // Check if order document exists
    if (!orderDoc.exists) {
      return response.status(404).json({ error: "Order not found" });
    }

    // Get order data and current status
    const orderData = orderDoc.data();
    const currentStatus = orderData.status;

    // Authorization check: seller can update their own orders, admin can update any
    const isAdmin = userData.role === "admin";
    const isSeller = userData.role === "seller" && orderData.sellerId === userId;
    const isBuyer = orderData.buyerId === userId;

    // Buyers can ONLY cancel orders (and only if order is pending or confirmed)
    if (isBuyer) {
      if (status !== "cancelled") {
        return response.status(403).json({ 
          error: "Unauthorized: buyers can only cancel orders, not update other statuses" 
        });
      }
      // Check if already cancelled FIRST (before checking pending/confirmed)
      if (currentStatus === "cancelled") {
        return response.status(400).json({ error: "Order is already cancelled" });
      }
      // Buyers can only cancel orders that are pending or confirmed
      if (currentStatus !== "pending" && currentStatus !== "confirmed") {
        return response.status(400).json({ 
          error: "Cannot cancel order: order must be in 'pending' or 'confirmed' status to cancel" 
        });
      }
    }

    if (!isAdmin && !isSeller && !isBuyer) {
      return response.status(403).json({ error: "Unauthorized: you can only update your own orders" });
    }

    // Status transition validation
    // Prevent cancelling an already delivered order (logical constraint)
    if (status === "cancelled" && currentStatus === "delivered") {
      return response.status(400).json({ error: "Cannot cancel a delivered order" });
    }
    // Prevent refunding an unpaid order (since no payment was made)
    if (status === "refunded" && currentStatus !== "paid" && orderData.paymentStatus !== "paid") {
      return response.status(400).json({ error: "Cannot refund an unpaid order" });
    }

    // Prepare update data
    const updateData = {
      status, // new status
      updatedAt: FieldValue.serverTimestamp(), // always update last modified time
    };

    // Add timestamp and tracking info for specific status changes
    // When shipped: Add tracking number (MANDATORY)
    if (status === "shipped") {
      // DELIVERY TRACKING: Tracking number is required when order is shipped
      if (!trackingNumber) {
        return response.status(400).json({ 
          error: "Tracking number is required when marking order as shipped",
          details: "Please provide trackingNumber in the request body"
        });
      }

      // Validate tracking number is not empty
      if (typeof trackingNumber !== "string" || trackingNumber.trim().length === 0) {
        return response.status(400).json({ 
          error: "Invalid tracking number",
          details: "Tracking number must be a non-empty string"
        });
      }

      updateData.shippedAt = FieldValue.serverTimestamp();
      updateData.trackingNumber = trackingNumber.trim();
      updateData.trackingProvider = trackingProvider || "local_courier"; // Default to local_courier
    }

    // Add timestamp for specific status changes (delivered, cancelled, refunded)
    // When delivered:
    if (status === "delivered") {
      updateData.deliveredAt = FieldValue.serverTimestamp();
      
      // PROOF OF DELIVERY: Required for delivery confirmation (anti-fraud measure)
      // Design requirement: "Courier proof-of-delivery or OTP confirmation for COD transactions"
      if (!proofOfDelivery) {
        return response.status(400).json({ 
          error: "Proof of delivery is required when marking order as delivered",
          details: "Please provide proofOfDelivery with at least one of: photoURL, otpCode, signatureURL, or deliveryNotes"
        });
      }

      // Validate proof of delivery structure
      const proofTypes = {
        photoURL: proofOfDelivery.photoURL,
        otpCode: proofOfDelivery.otpCode,
        signatureURL: proofOfDelivery.signatureURL,
        deliveryNotes: proofOfDelivery.deliveryNotes,
      };

      // At least one proof type must be provided
      const hasProof = proofTypes.photoURL || proofTypes.otpCode || proofTypes.signatureURL || proofTypes.deliveryNotes;
      if (!hasProof) {
        return response.status(400).json({ 
          error: "Invalid proof of delivery",
          details: "Please provide at least one of: photoURL, otpCode, signatureURL, or deliveryNotes"
        });
      }

      // For COD transactions, OTP confirmation is strongly recommended (but not strictly required if photo/signature provided)
      if (orderData.paymentMethod === "COD" && !proofTypes.otpCode && !proofTypes.photoURL && !proofTypes.signatureURL) {
        return response.status(400).json({ 
          error: "COD orders require stronger proof of delivery",
          details: "For COD transactions, please provide otpCode, photoURL, or signatureURL as proof of delivery"
        });
      }

      // Store proof of delivery in order document
      updateData.proofOfDelivery = {
        photoURL: proofTypes.photoURL || null,
        otpCode: proofTypes.otpCode || null,
        signatureURL: proofTypes.signatureURL || null,
        deliveryNotes: proofTypes.deliveryNotes || null,
        confirmedBy: userId, // Who confirmed the delivery (seller/admin)
        confirmedAt: FieldValue.serverTimestamp(),
      };

      // Auto-update payment status for COD on delivery
      if (orderData.paymentMethod === "COD" && orderData.paymentStatus === "pending") {
        updateData.paymentStatus = "paid";
      }
      
      // Automatic escrow release: Release escrow when order is delivered and paid
      // This happens automatically after delivery proof (status = "delivered")
      // and payment confirmation (paymentStatus = "paid")
      const finalPaymentStatus = updateData.paymentStatus || orderData.paymentStatus;
      if (finalPaymentStatus === "paid" && !orderData.escrowReleased) {
        updateData.escrowReleased = true;
        updateData.escrowReleasedAt = FieldValue.serverTimestamp();
        updateData.escrowReleasedBy = "system"; // Automated release
      }
    }

    // Check if stock restoration is needed (for cancelled or refunded orders)
    const needsStockRestoration = 
      (status === "cancelled" && currentStatus !== "cancelled") || 
      status === "refunded";

    // Use transaction to ensure atomicity: stock restoration and order update happen together
    // If stock restoration fails, order status won't be updated (prevents inconsistent state)
    if (needsStockRestoration) {
      const firestore = admin.firestore();
      
      try {
        await firestore.runTransaction(async (transaction) => {
          // Step 1: Read all products to verify they exist and restore stock atomically
          const productRefs = orderData.products.map(product =>
            firestore.collection("products").doc(product.productId)
          );
          const productDocs = await Promise.all(
            productRefs.map(ref => transaction.get(ref))
          );

          // Step 2: Verify products exist and restore stock
          for (let i = 0; i < orderData.products.length; i++) {
            const product = orderData.products[i];
            const productDoc = productDocs[i];

            if (!productDoc.exists) {
              throw new Error(
                `Cannot restore stock: Product ${product.productId} not found. Order status update aborted.`
              );
            }

            // Restore stock within transaction (atomic with order update)
            transaction.update(productRefs[i], {
              stock: FieldValue.increment(product.quantity),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          // Step 3: Update order status within same transaction
          if (status === "cancelled") {
            updateData.cancelledAt = FieldValue.serverTimestamp();
          }
          if (status === "refunded") {
            updateData.paymentStatus = "refunded";
          }

          transaction.update(orderRef, updateData);
        });
      } catch (transactionError) {
        // If transaction fails (e.g., product deleted), don't update order status
        logger.error("Failed to restore stock and update order status:", {
          orderId,
          status,
          error: transactionError.message,
          stack: transactionError.stack,
        });

        // Check if error is due to product not found
        if (transactionError.message.includes("not found")) {
          return response.status(404).json({
            error: "Cannot update order status",
            details: transactionError.message,
          });
        }

        // Other transaction errors (network, permissions, etc.)
        return response.status(500).json({
          error: "Failed to update order status",
          details: "Stock restoration failed. Order status was not updated to maintain data consistency.",
        });
      }
    } else {
      // No stock restoration needed, just update order status
      if (status === "cancelled") {
        updateData.cancelledAt = FieldValue.serverTimestamp();
      }
      await orderRef.update(updateData);
    }

    // Log status change (useful for dispute resolution and analytics)
    await logOrderEvent(orderId, "status_updated", userId, {
      oldStatus: currentStatus,
      newStatus: status,
      notes: notes || null,
    });

    // Log tracking number when order is shipped (mandatory)
    if (status === "shipped") {
      await logOrderEvent(orderId, "tracking_number_added", userId, {
        trackingNumber: updateData.trackingNumber,
        trackingProvider: updateData.trackingProvider,
      });
      logger.info(`Tracking number ${updateData.trackingNumber} added to order ${orderId} by ${userId}`);
    }

    // Log escrow release if it was automatically released
    if (status === "delivered" && updateData.escrowReleased) {
      await logOrderEvent(orderId, "escrow_released", "system", {
        sellerId: orderData.sellerId,
        amount: orderData.totalAmount,
        automatic: true,
        triggeredBy: "delivery_confirmation",
      });
      logger.info(`Escrow automatically released for order ${orderId} after delivery confirmation`);
    }

    // Log proof of delivery for audit trail (anti-fraud measure)
    if (status === "delivered" && updateData.proofOfDelivery) {
      await logOrderEvent(orderId, "delivery_proof_submitted", userId, {
        proofType: updateData.proofOfDelivery.otpCode ? "otp" : 
                   updateData.proofOfDelivery.photoURL ? "photo" :
                   updateData.proofOfDelivery.signatureURL ? "signature" : "notes",
        hasOTP: !!updateData.proofOfDelivery.otpCode,
        hasPhoto: !!updateData.proofOfDelivery.photoURL,
        hasSignature: !!updateData.proofOfDelivery.signatureURL,
        paymentMethod: orderData.paymentMethod,
      });
      logger.info(`Proof of delivery submitted for order ${orderId} by ${userId}`);
    }

    // Helpful info log for emulator or production monitoring
    logger.info(`Order ${orderId} status updated from ${currentStatus} to ${status} by ${userId}`);

    // Respond to client
    return response.json({
      success: true,
      message: "Order status updated successfully",
      orderId,
      status,
    });
  } catch (error) {
    logger.error("Error updating order status:", error);
    return response.status(500).json({
      error: "Failed to update order status",
      details: error.message,
    });
  }
});