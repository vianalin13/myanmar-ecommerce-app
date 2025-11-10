/**
 * GET PUBLIC PRODUCTS
 * Fetches all active products for buyers to browse.
 * 
 * FUNCTION FLOW:
 * 1. VALIDATION: HTTP method (GET only)
 * 2. FETCH: Get all products where status is "active"
 * 3. RESPONSE: Return products array (empty if none found)
 * 
 * Note: No authentication required - this is a public endpoint for buyers.
 */

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

exports.getPublicProducts = onRequest(async (request, response) => {
  try {
    if (request.method !== "GET") {
      return response.status(405).json({ error: "Use GET method" });
    }

    const productsRef = admin.firestore().collection("products");
    const snapshot = await productsRef
      .where("status", "==", "active")
      .get();

    if (snapshot.empty) {
      return response.json({ success: true, count: 0, products: [] });
    }

    const products = snapshot.docs.map(doc => ({
      productId: doc.id,
      ...doc.data(),
    }));

    return response.json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    logger.error("Error fetching public products:", error);
    return response.status(500).json({
      error: "Failed to fetch products",
      details: error.message,
    });
  }
});

