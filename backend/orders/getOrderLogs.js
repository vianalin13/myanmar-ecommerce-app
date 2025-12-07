const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth");

/**
 * GET ORDER LOGS
 * Retrieve complete audit trail for an order
 * 
 * Admin-only function for dispute resolution and transparency demonstration.
 * Returns all logged events for a specific order, sorted chronologically.
 * 
 * FUNCTION FLOW:
 * 1. VALIDATION: HTTP method, required fields (orderId), user authentication
 * 2. AUTHORIZATION: Verify user is admin (only admins can view audit logs)
 * 3. ORDER VALIDATION: Verify order exists
 * 4. FETCH LOGS: Retrieve all logs from orderLogs collection for this orderId
 * 5. SORT: Sort logs by timestamp (ascending - chronological order)
 * 6. RESPONSE: Return logs with count
 * 
 * Event Types Logged:
 * - order_created: Order was created
 * - payment_confirmed: Payment was confirmed
 * - status_updated: Order status was changed
 * - order_refunded: Order was refunded (cancelled paid order)
 * - tracking_number_added: Tracking number added when shipped
 * - delivery_proof_submitted: Proof of delivery submitted
 * - escrow_released: Escrow was released (automatic or manual)
 */
exports.getOrderLogs = onRequest(async (request, response) => {
  try {
    // Only allow GET requests
    if (request.method !== "GET") {
      return response.status(405).json({ error: "Use GET method" });
    }

    // Verify user authentication
    let userId, userData;
    try {
      const verified = await verifyUser(request);
      userId = verified.uid;
      userData = verified.user;
    } catch (error) {
      // Handle authentication errors specifically
      if (error.message.includes("Missing or invalid Authorization header") || 
          error.message.includes("Authentication failed")) {
        return response.status(401).json({ 
          error: "Authentication required" 
        });
      }
      // Re-throw other errors
      throw error;
    }

    // AUTHORIZATION: Only admins can view audit logs
    if (userData.role !== "admin") {
      return response.status(403).json({ 
        error: "Unauthorized: only admins can view order audit logs" 
      });
    }

    const { orderId } = request.query;

    // Validate required parameter
    if (!orderId) {
      return response.status(400).json({ 
        error: "Missing required parameter: orderId" 
      });
    }

    // Verify order exists (for better error messages)
    const orderRef = admin.firestore().collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return response.status(404).json({ error: "Order not found" });
    }

    // Fetch all logs for this order from orderLogs collection
    const logsQuery = admin.firestore()
      .collection("orderLogs")
      .where("orderId", "==", orderId);

    const logsSnapshot = await logsQuery.get();

    // Format logs for response and sort by timestamp (chronological order)
    const logs = logsSnapshot.docs
      .map(doc => {
        const logData = doc.data();
        return {
          logId: doc.id,
          eventType: logData.eventType,
          actorId: logData.actorId,
          timestamp: logData.timestamp,
          metadata: logData.metadata || {},
        };
      })
      .sort((a, b) => {
        // Sort by timestamp (ascending - oldest first)
        // Handle cases where timestamp might be null or undefined
        if (!a.timestamp && !b.timestamp) return 0;
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        
        // Convert Firestore Timestamp to milliseconds for comparison
        const aTime = a.timestamp.toMillis ? a.timestamp.toMillis() : a.timestamp;
        const bTime = b.timestamp.toMillis ? b.timestamp.toMillis() : b.timestamp;
        return aTime - bTime;
      });

    logger.info(`Retrieved ${logs.length} audit logs for order ${orderId} by admin ${userId}`);

    // Return logs with count
    return response.json({
      success: true,
      orderId,
      count: logs.length,
      logs,
    });
  } catch (error) {
    logger.error("Error fetching order logs:", error);

    // Handle Firestore query errors
    if (error.code === 9 || error.message.includes("index")) {
      return response.status(500).json({
        error: "Database query error",
        details: "An index may be required. Please check Firestore indexes.",
        message: error.message,
      });
    }

    return response.status(500).json({
      error: "Failed to fetch order logs",
      details: error.message,
    });
  }
});

