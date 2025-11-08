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
    const { orderId, status, notes } = request.body;

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

    // Add timestamp for specific status changes (delivered, cancelled, refunded)
    // When delivered:
    if (status === "delivered") {
      updateData.deliveredAt = FieldValue.serverTimestamp();
      // Auto-update payment status for COD on delivery
      if (orderData.paymentMethod === "COD" && orderData.paymentStatus === "pending") {
        updateData.paymentStatus = "paid";
      }
    }
    // When cancelled:
    if (status === "cancelled") {
      updateData.cancelledAt = FieldValue.serverTimestamp();
      // Restore stock if order is cancelled
      if (currentStatus !== "cancelled") {
        const batch = admin.firestore().batch();
        for (const product of orderData.products) {
          const productRef = admin.firestore().collection("products").doc(product.productId);
          batch.update(productRef, {
            stock: FieldValue.increment(product.quantity), // return stock to inventory
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit(); // execute all stock restorations together
      }
    }

    // When refunded:
    if (status === "refunded") {
      updateData.paymentStatus = "refunded"; // update payment status to refunded
      // Restore stock to seller's inventory
      const batch = admin.firestore().batch();
      for (const product of orderData.products) {
        const productRef = admin.firestore().collection("products").doc(product.productId);
        batch.update(productRef, {
          stock: FieldValue.increment(product.quantity),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    // Update order
    await orderRef.update(updateData);

    // Log status change (useful for dispute resolution and analytics)
    await logOrderEvent(orderId, "status_updated", userId, {
      oldStatus: currentStatus,
      newStatus: status,
      notes: notes || null,
    });

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