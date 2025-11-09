const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth");
const { logOrderEvent } = require("./utils");

/**
 * SIMULATE PAYMENT
 * This function mocks payment confirmation for mobile money transactions.
 * - Used for methods like KBZPay or WavePay.
 * - COD (Cash on Delivery) is confirmed automatically after delivery, so this endpoint rejects COD.
 * 
 * Future: Can be replaced by real KBZPay / WaveMoney API webhooks.
 */
exports.simulatePayment = onRequest(async (request, response) => {
  try {
    // Only allow POST requests
    if (request.method !== "POST") {
      return response.status(405).json({ error: "Use POST method" });
    }

    // Verify user authentication
    const { uid: userId } = await verifyUser(request);

    // Extract main request fields
    const { orderId, transactionId, receiptId } = request.body;

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

    // Ensure only the buyer who placed this order can simulate payment
    if (orderData.buyerId !== userId) {
      return response.status(403).json({ error: "Unauthorized: you can only confirm payment for your own orders" });
    }

    // Check if already paid
    if (orderData.paymentStatus === "paid") {
      return response.status(400).json({ error: "Order is already paid" });
    }

    // COD payments are confirmed after delivery, not here
    if (orderData.paymentMethod === "COD") {
      return response.status(400).json({ error: "COD payment is confirmed on delivery, not through this endpoint" });
    }

    // Update payment status
    const paymentConfirmation = {
      receiptId: receiptId || `RECEIPT_${orderId}_${Date.now()}`,
      paidAt: FieldValue.serverTimestamp(),
      transactionId: transactionId || `TXN_${orderId}_${Date.now()}`,
    };

    // Prepare update data
    const updateData = {
      paymentStatus: "paid",
      paymentConfirmation,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Automatic escrow release: If order is already delivered, release escrow automatically
    // This handles the case where payment is confirmed after delivery
    if (orderData.status === "delivered" && !orderData.escrowReleased) {
      updateData.escrowReleased = true;
      updateData.escrowReleasedAt = FieldValue.serverTimestamp();
      updateData.escrowReleasedBy = "system"; // Automated release
    }

    // Update order with payment confirmation (and escrow release if applicable)
    await orderRef.update(updateData);

    // Log payment event
    await logOrderEvent(orderId, "payment_confirmed", userId, {
      paymentMethod: orderData.paymentMethod,
      transactionId: paymentConfirmation.transactionId,
      amount: orderData.totalAmount,
    });

    // Log escrow release if it was automatically released
    if (orderData.status === "delivered" && updateData.escrowReleased) {
      await logOrderEvent(orderId, "escrow_released", "system", {
        sellerId: orderData.sellerId,
        amount: orderData.totalAmount,
        automatic: true,
        triggeredBy: "payment_confirmation_after_delivery",
      });
      logger.info(`Escrow automatically released for order ${orderId} after payment confirmation (order already delivered)`);
    }

    logger.info(`Payment confirmed for order ${orderId} by buyer ${userId}`);

    return response.json({
      success: true,
      message: "Payment confirmed successfully",
      orderId,
      paymentConfirmation,
    });
  } catch (error) {
    logger.error("Error simulating payment:", error);
    return response.status(500).json({
      error: "Failed to confirm payment",
      details: error.message,
    });
  }
});

