const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth");

/**
 * GET ORDER BY ID
 * Get detailed information about a specific order
 * Accessible to:
 *  - the buyer (who placed the order),
 *  - the seller (who owns the order’s products),
 *  - or an admin (for moderation/disputes).
 */
exports.getOrderById = onRequest(async (request, response) => {
  try {
    // Only allow GET requests for this function
    if (request.method !== "GET") {
      return response.status(405).json({ error: "Use GET method" });
    }

    // Verify user authentication
    const { uid: userId, user: userData } = await verifyUser(request);

    const { orderId } = request.query;
    // If no orderId is provided, return a bad request response
    if (!orderId) {
      return response.status(400).json({ error: "Missing required parameter: orderId" });
    }

    // Fetch order document from Firestore
    const orderRef = admin.firestore().collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return response.status(404).json({ error: "Order not found" });
    }

    // Get order data from Firestore
    const orderData = orderDoc.data();

    // Authorization: buyer, seller, or admin can view
    const isAdmin = userData.role === "admin";
    const isBuyer = orderData.buyerId === userId;
    const isSeller = orderData.sellerId === userId;

    if (!isAdmin && !isBuyer && !isSeller) {
      return response.status(403).json({ error: "Unauthorized: you can only view your own orders" });
    }

    // Success — return the full order details
    return response.json({
      success: true,
      order: {
        orderId: orderDoc.id,
        ...orderData,   // include all order data// spread rest of Firestore data (timestamps, products, etc.)
      },
    });
  } catch (error) {
    logger.error("Error fetching order:", error);
    return response.status(500).json({
      error: "Failed to fetch order",
      details: error.message,
    });
  }
});

