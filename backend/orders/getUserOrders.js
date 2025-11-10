const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth");

/**
 * GET USER ORDERS
 * Returns all orders for a user based on their role (buyer or seller)
 * 
 * Note: Users can only be either buyer OR seller, not both.
 * The function automatically determines which orders to fetch based on the user's role.
 * Status filtering should be handled on the frontend.
 */
exports.getUserOrders = onRequest(async (request, response) => {
  try {
    // Only accept GET requests
    if (request.method !== "GET") {
      return response.status(405).json({ error: "Use GET method" });
    }

    // Verify user authentication
    const { uid: userId, user: userData } = await verifyUser(request);

    // Determine which orders to fetch based on user's role
    let orders = [];

    if (userData.role === "buyer") {
      // User is a buyer - fetch orders where they are the buyer
      const buyerQuery = admin.firestore().collection("orders")
        .where("buyerId", "==", userId)
        .orderBy("createdAt", "desc");
      
      const snapshot = await buyerQuery.get();
      orders = snapshot.docs.map(doc => ({
        orderId: doc.id,
        ...doc.data(),
        userRole: "buyer",
      }));

    } else if (userData.role === "seller") {
      // User is a seller - fetch orders where they are the seller
      const sellerQuery = admin.firestore().collection("orders")
        .where("sellerId", "==", userId)
        .orderBy("createdAt", "desc");
      
      const snapshot = await sellerQuery.get();
      orders = snapshot.docs.map(doc => ({
        orderId: doc.id,
        ...doc.data(),
        userRole: "seller",
      }));

    } else {
      // User has no role or invalid role
      return response.status(400).json({ 
        error: "User must have a valid role (buyer or seller)" 
      });
    }

    // Return results
    if (orders.length === 0) {
      return response.json({
        success: true,
        message: "No orders found",
        orders: [],
        count: 0,
      });
    }

    return response.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (error) {
    logger.error("Error fetching user orders:", error);
    return response.status(500).json({
      error: "Failed to fetch orders",
      details: error.message,
    });
  }
});

