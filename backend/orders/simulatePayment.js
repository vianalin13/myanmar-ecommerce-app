const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth");
const { logOrderEvent } = require("./auditLogger");

/**
 * SIMULATE PAYMENT
 * This function mocks payment confirmation for mobile money transactions.
 * - COD (Cash on Delivery) is confirmed automatically after delivery, so this endpoint rejects COD.
 * 
 * FUNCTION FLOW:
 * 1. VALIDATION: HTTP method, required fields (orderId, transactionId), user authentication
 * 2. AUTHORIZATION: Verify buyer owns the order
 * 3. ORDER STATUS VALIDATION: Reject cancelled/refunded orders
 * 4. PAYMENT STATUS VALIDATION: Reject already paid or refunded orders
 * 5. PAYMENT METHOD VALIDATION: Reject COD (confirmed on delivery)
 * 6. TRANSACTION: Atomically confirm payment and release escrow (if delivered)
 * 7. AUDIT LOGGING: Log payment confirmation and escrow release (if applicable)
 * 8. RESPONSE: Return success with payment confirmation details
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

    // TransactionId is required for mobile money payments
    // This ensures we have a valid transaction reference for audit and reconciliation
    if (!transactionId) {
      return response.status(400).json({ error: "Missing required field: transactionId" });
    }

    const firestore = admin.firestore();
    const orderRef = firestore.collection("orders").doc(orderId);

    // Use transaction to ensure atomicity: payment confirmation and escrow release happen together
    // Prevents race conditions where multiple payment confirmations could be processed
    await firestore.runTransaction(async (transaction) => {
      // Read order document within transaction
      const orderDoc = await transaction.get(orderRef);

      if (!orderDoc.exists) {
        throw new Error("Order not found");
      }

      const orderData = orderDoc.data();
      const currentStatus = orderData.status;
      const currentPaymentStatus = orderData.paymentStatus;

      // AUTHORIZATION: Ensure only the buyer who placed this order can simulate payment
      if (orderData.buyerId !== userId) {
        throw new Error("Unauthorized: you can only confirm payment for your own orders");
      }

      // ORDER STATUS VALIDATION: Reject cancelled or refunded orders
      // Payment cannot be confirmed for orders that are cancelled or refunded
      if (currentStatus === "cancelled" || currentStatus === "refunded") {
        throw new Error(`Cannot confirm payment: Order is ${currentStatus}. Payment cannot be confirmed for ${currentStatus} orders.`);
      }

      // PAYMENT STATUS VALIDATION: Reject already paid or refunded orders
      if (currentPaymentStatus === "paid") {
        throw new Error("Order is already paid");
      }
      if (currentPaymentStatus === "refunded") {
        throw new Error("Cannot confirm payment for a refunded order");
      }

      // PAYMENT METHOD VALIDATION: COD payments are confirmed after delivery, not here
      if (orderData.paymentMethod === "COD") {
        throw new Error("COD payment is confirmed on delivery, not through this endpoint");
      }

      // Prepare payment confirmation data
      const paymentConfirmation = {
        receiptId: receiptId || `RECEIPT_${orderId}_${Date.now()}`,
        paidAt: FieldValue.serverTimestamp(),
        transactionId: transactionId, // Required - validated above
      };

      // Prepare update data
      const updateData = {
        paymentStatus: "paid",
        paymentConfirmation,
        updatedAt: FieldValue.serverTimestamp(),
      };

      // AUTOMATIC ESCROW RELEASE: Release escrow when order is delivered and payment is confirmed
      // This handles the case where payment is confirmed after delivery
      // Escrow is released automatically when: status = "delivered" AND paymentStatus = "paid"
      const finalPaymentStatus = "paid"; // Payment will be confirmed in this transaction
      if (currentStatus === "delivered" && finalPaymentStatus === "paid" && !orderData.escrowReleased) {
        updateData.escrowReleased = true;
        updateData.escrowReleasedAt = FieldValue.serverTimestamp();
        updateData.escrowReleasedBy = "system"; // Automated release
      }

      // Update order within transaction (atomic with validation checks)
      transaction.update(orderRef, updateData);
    });

    // After transaction succeeds, fetch order data for logging and response
    const orderDoc = await orderRef.get();
    const orderData = orderDoc.data();

    // Log payment event
    await logOrderEvent(orderId, "payment_confirmed", userId, {
      paymentMethod: orderData.paymentMethod,
      transactionId: transactionId,
      amount: orderData.totalAmount,
    });

    // Log escrow release if it was automatically released
    if (orderData.status === "delivered" && orderData.escrowReleased) {
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
      paymentConfirmation: {
        receiptId: orderData.paymentConfirmation.receiptId,
        transactionId: orderData.paymentConfirmation.transactionId,
        paidAt: orderData.paymentConfirmation.paidAt,
      },
    });
  } catch (error) {
    logger.error("Error simulating payment:", error);
    
    // Handle specific error messages from validation
    if (error.message === "Order not found") {
      return response.status(404).json({ error: "Order not found" });
    }
    if (error.message.includes("Unauthorized")) {
      return response.status(403).json({ error: error.message });
    }
    if (error.message.includes("Cannot confirm payment") || 
        error.message.includes("already paid") || 
        error.message.includes("refunded") ||
        error.message.includes("COD payment")) {
      return response.status(400).json({ error: error.message });
    }
    
    return response.status(500).json({
      error: "Failed to confirm payment",
      details: error.message,
    });
  }
});

