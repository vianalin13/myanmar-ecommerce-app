const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth");

/**
 * GET USER ORDERS
 * Returns all orders for a user (as buyer or seller)
 */
exports.getUserOrders = onRequest(async (request, response) => {
  try {
    // Only accept GET requests
    if (request.method !== "GET") {
      return response.status(405).json({ error: "Use GET method" });
    }

    // Verify user authentication
    const { uid: userId, user: userData } = await verifyUser(request);

    const { role, orderStatus } = request.query; // role: "buyer" | "seller", orderStatus: optional filter

    // Filter by role and handle status filtering
    let orders = [];

    // Fetch orders as a BUYER
    if (role === "buyer") {
      // Fetch buyer orders
      const buyerQuery = admin.firestore().collection("orders")
        .where("buyerId", "==", userId) // Match current user as buyer
        .orderBy("createdAt", "desc");  // Sort most recent first
      
      // Map Firestore docs into plain JS objects with userRole label
      const snapshot = await buyerQuery.get();
      orders = snapshot.docs.map(doc => ({
        orderId: doc.id,
        ...doc.data(),
        userRole: "buyer",
      }));

    // Fetch orders as a SELLER
    } else if (role === "seller") {
      // Verify seller role
      if (userData.role !== "seller") {
        return response.status(403).json({ error: "Unauthorized: user is not a seller" });
      }
      
      // Fetch seller orders
      const sellerQuery = admin.firestore().collection("orders")
        .where("sellerId", "==", userId)
        .orderBy("createdAt", "desc");
      
      const snapshot = await sellerQuery.get();
      orders = snapshot.docs.map(doc => ({
        orderId: doc.id,
        ...doc.data(),
        userRole: "seller",
      }));

      // Fetch ALL orders related to the user (either buyer or seller)
      // Note: In this platform, users can only be either buyer OR seller, not both
    } else {
      // Determine which orders to fetch based on user's role
      if (userData.role === "buyer") {
        // User is a buyer - fetch buyer orders
        const buyerQuery = admin.firestore().collection("orders")
          .where("buyerId", "==", userId)
          .orderBy("createdAt", "desc");
        
        const buyerSnapshot = await buyerQuery.get();
        orders = buyerSnapshot.docs.map(doc => ({
          orderId: doc.id,
          ...doc.data(),
          userRole: "buyer",
        }));
      } else if (userData.role === "seller") {
        // User is a seller - fetch seller orders
        const sellerQuery = admin.firestore().collection("orders")
          .where("sellerId", "==", userId)
          .orderBy("createdAt", "desc");
        
        const sellerSnapshot = await sellerQuery.get();
        orders = sellerSnapshot.docs.map(doc => ({
          orderId: doc.id,
          ...doc.data(),
          userRole: "seller",
        }));
      }
      // If user has no role or invalid role, orders array remains empty
    }

    // Optional Filter:
    // Apply status filter client-side (to avoid composite index requirements)
    if (orderStatus) {
      orders = orders.filter(order => order.status === orderStatus);
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

