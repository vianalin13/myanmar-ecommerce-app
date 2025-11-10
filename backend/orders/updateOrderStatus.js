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
 * 
 * FUNCTION FLOW:
 * 1. VALIDATION: HTTP method, required fields, valid statuses, user authentication
 * 2. AUTHORIZATION: Check user role (buyer/seller/admin) and permissions
 * 3. STATUS VALIDATION: Validate status transitions (prevent invalid changes)
 * 4. FINAL STATUS: Determine final status
 * 5. UPDATE DATA: Prepare update data with status-specific fields:
 *    - Shipped: tracking number (required)
 *    - Delivered: proof of delivery (required), COD payment confirmation, escrow release
 *    - Cancelled: cancelledAt timestamp (set when cancellation is requested)
 *    - Refunded: refundedAt, refundedBy, paymentStatus (set when paid order is cancelled)
 *      Note: Refunded orders also have cancelledAt (cancellation was requested)
 * 6. STOCK RESTORATION: Restore stock atomically if cancelling pending/confirmed orders
 * 7. UPDATE ORDER: Update order status (with or without transaction)
 * 8. AUDIT LOGGING: Log all status changes, refunds, tracking, delivery proof, escrow releases
 * 9. RESPONSE: Return success with final status
 * 
 * Status Rules:
 * - Cancelled: Can only be set if order is pending or confirmed (before shipping)
 *   - If payment was paid → Status becomes "refunded" (payment refunded)
 *   - If payment was not paid → Status becomes "cancelled" (payment stays pending)
 * - Stock restoration: Always occurs for cancelled/refunded orders (pending/confirmed only)
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

    // Verify user
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
      // Check if already cancelled or refunded FIRST (before checking pending/confirmed)
      if (currentStatus === "cancelled" || currentStatus === "refunded") {
        return response.status(400).json({ error: "Order is already cancelled or refunded" });
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
    // Prevent cancelling an already shipped order (logical constraint)
    if (status === "cancelled" && currentStatus === "shipped") {
      return response.status(400).json({ error: "Cannot cancel a shipped order" });
    }
    // Prevent setting "refunded" status directly (it's automatically set when cancelling paid orders)
    if (status === "refunded") {
      return response.status(400).json({ 
        error: "Cannot set refunded status directly. Refunded status is automatically set when cancelling an order with paid payment." 
      });
    }

    // Determine final status for cancellation
    // If cancelling a paid order, status becomes "refunded" (payment refunded)
    // If cancelling an unpaid order, status stays "cancelled" (payment stays pending)
    let finalStatus = status;
    if (status === "cancelled") {
      if (orderData.paymentStatus === "paid") {
        // Payment was paid → status becomes "refunded"
        finalStatus = "refunded";
      } else {
        // Payment was not paid → status stays "cancelled"
        finalStatus = "cancelled";
      }
    }

    // Prepare update data
    // Note: Status may change from "cancelled" to "refunded" if payment was paid
    const updateData = {
      status: finalStatus, // final status (may be "refunded" if payment was paid)
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

    // Set timestamps and payment status based on final status
    // Do this BEFORE transaction/no-transaction branch to avoid duplication
    if (status === "cancelled") {
      // Set cancelledAt when cancellation is requested (regardless of final status)
      // This applies to both unpaid (stays "cancelled") and paid (becomes "refunded") orders
      updateData.cancelledAt = FieldValue.serverTimestamp();
    }
    
    if (finalStatus === "refunded") {
      // Refunded status: payment was paid, so refund it
      updateData.paymentStatus = "refunded";
      updateData.refundedAt = FieldValue.serverTimestamp();
      updateData.refundedBy = userId;
    }

    // Check if stock restoration is needed (for cancelled/refunded orders)
    // Stock is always restored when cancelling (regardless of payment status)
    // Only restore stock if order is pending or confirmed (before shipping)
    const needsStockRestoration = 
      status === "cancelled" && 
      (currentStatus === "pending" || currentStatus === "confirmed");

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
          // Note: Timestamps and payment status are already set in updateData above
          transaction.update(orderRef, updateData);
        });
      } catch (transactionError) {
        // If transaction fails (e.g., product deleted), don't update order status
        logger.error("Failed to restore stock and update order status:", {
          orderId,
          finalStatus, // Use finalStatus for accuracy (may be "refunded" if payment was paid)
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
      // Note: Timestamps and payment status are already set in updateData above
      await orderRef.update(updateData);
    }

    // Log status change (useful for dispute resolution and analytics)
    await logOrderEvent(orderId, "status_updated", userId, {
      oldStatus: currentStatus,
      newStatus: finalStatus, // Log final status (may be "refunded" if payment was paid)
      notes: notes || null,
    });

    // Log refund event if order was refunded
    if (finalStatus === "refunded") {
      await logOrderEvent(orderId, "order_refunded", userId, {
        refundedBy: userId,
        refundedAmount: orderData.totalAmount,
        paymentMethod: orderData.paymentMethod,
        triggeredBy: "cancellation",
      });
      logger.info(`Order ${orderId} refunded by ${userId} (payment was paid, cancelled order)`);
    }

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
    logger.info(`Order ${orderId} status updated from ${currentStatus} to ${finalStatus} by ${userId}`);

    // Respond to client
    return response.json({
      success: true,
      message: "Order status updated successfully",
      orderId,
      status: finalStatus, // Return final status (may be "refunded" if payment was paid)
    });
  } catch (error) {
    logger.error("Error updating order status:", error);
    return response.status(500).json({
      error: "Failed to update order status",
      details: error.message,
    });
  }
});