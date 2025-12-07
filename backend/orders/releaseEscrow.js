const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth");
const { logOrderEvent } = require("./auditLogger");

/**
 * RELEASE ESCROW (Manual Override)
 * Manual escrow release function for edge cases.
 * 
 * FUNCTION FLOW:
 * 1. VALIDATION: HTTP method, required fields (orderId), user authentication
 * 2. AUTHORIZATION: Verify user is admin (only admins can manually release escrow)
 * 3. SAFETY VALIDATION: Reject cancelled/refunded orders (defensive safety)
 * 4. ESCROW STATUS VALIDATION: Check if escrow already released (prevent duplicates)
 * 5. TRANSACTION: Atomically release escrow (prevents race conditions)
 * 6. AUDIT LOGGING: Log escrow release event
 * 7. RESPONSE: Return success with escrow release details
 * 
 * Note: Escrow is automatically released when order status becomes "delivered"
 * and payment is confirmed. This function is only needed for manual override
 * in special cases (e.g., if automatic release failed).
 * 
 * Assumption: Admin only calls this function when order is delivered and paid.
 * Minimal validation is kept for safety (cancelled/refunded orders, already released).
 */
exports.releaseEscrow = onRequest(async (request, response) => {
  try {
    // Only allow POST requests
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

    const firestore = admin.firestore();
    const orderRef = firestore.collection("orders").doc(orderId);

    // Use transaction to ensure atomicity: escrow release happens atomically
    // Prevents race conditions where multiple admins try to release escrow simultaneously
    await firestore.runTransaction(async (transaction) => {
      // Read order document within transaction
      const orderDoc = await transaction.get(orderRef);

      if (!orderDoc.exists) {
        throw new Error("Order not found");
      }

      const orderData = orderDoc.data();
      const currentStatus = orderData.status;

      // SAFETY VALIDATION: Reject cancelled or refunded orders (defensive safety)
      // This protects against edge cases (race conditions, admin mistakes, bugs)
      // Escrow should never be released for cancelled or refunded orders
      if (currentStatus === "cancelled" || currentStatus === "refunded") {
        throw new Error(`Cannot release escrow: Order is ${currentStatus}. Escrow cannot be released for ${currentStatus} orders.`);
      }

      // ESCROW STATUS VALIDATION: Check if escrow already released (prevent duplicates)
      // Critical check to prevent duplicate escrow releases (race condition protection)
      if (orderData.escrowReleased) {
        throw new Error("Escrow already released for this order");
      }

      // Note: We assume admin only calls this when order is delivered and paid.
      // No explicit validation for "delivered" or "paid" status to avoid redundancy.
      // The cancelled/refunded check above provides defensive safety.

      // All conditions met — mark escrow as released within transaction
      transaction.update(orderRef, {
        escrowReleased: true,
        escrowReleasedAt: FieldValue.serverTimestamp(),
        escrowReleasedBy: userId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    // After transaction succeeds, fetch order data for logging and response
    const orderDoc = await orderRef.get();
    const orderData = orderDoc.data();

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
    
    // Handle specific error messages from validation
    if (error.message === "Order not found") {
      return response.status(404).json({ error: "Order not found" });
    }
    if (error.message.includes("Cannot release escrow") || 
        error.message.includes("Escrow already released")) {
      return response.status(400).json({ error: error.message });
    }
    
    return response.status(500).json({
      error: "Failed to release escrow",
      details: error.message,
    });
  }
});

