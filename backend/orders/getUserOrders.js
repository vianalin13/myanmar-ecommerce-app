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
    if (request.method !== "GET") {
      return response.status(405).json({ error: "Use GET method" });
    }

    // Verify user authentication
    const { uid: userId, user: userData } = await verifyUser(request);

    const { role, orderStatus } = request.query; // role: "buyer" | "seller", orderStatus: optional filter

    // Filter by role and handle status filtering
    let orders = [];

    if (role === "buyer") {
      // Fetch buyer orders
      const buyerQuery = admin.firestore().collection("orders")
        .where("buyerId", "==", userId)
        .orderBy("createdAt", "desc");
      
      const snapshot = await buyerQuery.get();
      orders = snapshot.docs.map(doc => ({
        orderId: doc.id,
        ...doc.data(),
        userRole: "buyer",
      }));

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

    } else {
      // Return all orders where user is either buyer or seller
      // Firestore doesn't support OR queries directly, so we'll fetch both and merge
      const buyerQuery = admin.firestore().collection("orders")
        .where("buyerId", "==", userId)
        .orderBy("createdAt", "desc");
      
      const buyerSnapshot = await buyerQuery.get();
      buyerSnapshot.docs.forEach(doc => {
        orders.push({
          orderId: doc.id,
          ...doc.data(),
          userRole: "buyer",
        });
      });

      // Fetch seller orders if user is a seller
      if (userData.role === "seller") {
        const sellerQuery = admin.firestore().collection("orders")
          .where("sellerId", "==", userId)
          .orderBy("createdAt", "desc");
        
        const sellerSnapshot = await sellerQuery.get();
        sellerSnapshot.docs.forEach(doc => {
          const existingOrder = orders.find(o => o.orderId === doc.id);
          if (existingOrder) {
            existingOrder.userRole = "both";
          } else {
            orders.push({
              orderId: doc.id,
              ...doc.data(),
              userRole: "seller",
            });
          }
        });
      }

      // Sort by createdAt (descending) - in case of duplicates from merging
      orders.sort((a, b) => {
        const aTime = a.createdAt?.toMillis() || 0;
        const bTime = b.createdAt?.toMillis() || 0;
        return bTime - aTime;
      });
    }

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

