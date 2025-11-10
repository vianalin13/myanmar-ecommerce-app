/**
 * GET SELLER PRODUCTS
 * Fetches all products listed by the authenticated seller.
 * 
 * FUNCTION FLOW:
 * 1. VALIDATION: HTTP method (GET only)
 * 2. AUTHORIZATION: Verify seller role
 * 3. FETCH: Get all products where sellerId matches authenticated seller
 * 4. RESPONSE: Return products array (empty if none found)
 */

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifySellerRole } = require("../auth");

exports.getSellerProducts = onRequest(async (request, response) => {
  try {
    if (request.method !== "GET") {
      return response.status(405).json({ error: "Use GET method" });
    }

    // Verify seller role
    const { uid: userId, user } = await verifySellerRole(request);

    const productsSnapshot = await admin
      .firestore()
      .collection("products")
      .where("sellerId", "==", userId)
      .get();

    if (productsSnapshot.empty) {
      return response.json({
        success: true,
        message: "No products found for this seller",
        products: [],
      });
    }

    const products = productsSnapshot.docs.map(doc => ({
      productId: doc.id,
      ...doc.data(),
    }));

    return response.json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    logger.error("Error fetching seller products:", error);
    return response.status(500).json({
      error: "Failed to fetch seller products",
      details: error.message,
    });
  }
});

