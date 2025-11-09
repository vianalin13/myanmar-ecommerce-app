const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth");
const { logOrderEvent } = require("./utils");

/**
 * RELEASE ESCROW (Manual Override)
 * Manual escrow release function for edge cases.
 * 
 * Note: Escrow is automatically released when order status becomes "delivered"
 * and payment is confirmed. This function is only needed for manual override
 * in special cases (e.g., if automatic release failed).
 */
exports.releaseEscrow = onRequest(async (request, response) => {
  try {
    if (request.method !== "POST") {
      return response.status(405).json({ error: "Use POST method" });
    }

    // Verify admin authentication (only admins can manually release escrow)
    const { uid: userId, user: userData } = await verifyUser(request);

    if (userData.role !== "admin") {
      return response.status(403).json({ error: "Unauthorized: only admins can manually release escrow" });
    }

    const { orderId } = request.body;

    if (!orderId) {
      return response.status(400).json({ error: "Missing required field: orderId" });
    }

    // Get order
    const orderRef = admin.firestore().collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return response.status(404).json({ error: "Order not found" });
    }

    const orderData = orderDoc.data();

    // Verify order is delivered and paid
    if (orderData.status !== "delivered") {
      return response.status(400).json({ error: "Order must be delivered before releasing escrow" });
    }
    if (orderData.paymentStatus !== "paid") {
      return response.status(400).json({ error: "Order payment must be confirmed before releasing escrow" });
    }

    // Check if escrow already released
    if (orderData.escrowReleased) {
      return response.status(400).json({ error: "Escrow already released for this order" });
    }

    // All conditions met — mark escrow as released
    await orderRef.update({
      escrowReleased: true,
      escrowReleasedAt: FieldValue.serverTimestamp(),
      escrowReleasedBy: userId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Log escrow release
    await logOrderEvent(orderId, "escrow_released", userId, {
      sellerId: orderData.sellerId,
      amount: orderData.totalAmount,
      manual: true,
      triggeredBy: "admin_override",
    });

    logger.info(`Escrow manually released for order ${orderId} to seller ${orderData.sellerId} by admin ${userId}`);

    return response.json({
      success: true,
      message: "Escrow released successfully",
      orderId,
      amount: orderData.totalAmount,
      sellerId: orderData.sellerId,
    });
  } catch (error) {
    logger.error("Error releasing escrow:", error);
    return response.status(500).json({
      error: "Failed to release escrow",
      details: error.message,
    });
  }
});

