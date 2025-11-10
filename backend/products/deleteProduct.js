/**
 * DELETE PRODUCT (Soft Delete)
 * Allows a seller to soft delete their product by setting status to "inactive".
 * 
 * FUNCTION FLOW:
 * 1. VALIDATION: HTTP method, productId
 * 2. AUTHORIZATION: Verify seller role and product ownership
 * 3. VALIDATION: Check product exists and seller owns it
 * 4. UPDATE: Set product status to "inactive" (soft delete)
 * 5. RESPONSE: Return success
 * 
 * Note: Orders store product snapshots (name, price, image) at creation time,
 * so deleting a product does not affect existing orders. Orders are independent
 * and contain all necessary product information for fulfillment.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifySellerRole } = require("../auth");

exports.deleteProduct = onRequest(async (request, response) => {
  try {
    if (request.method !== "DELETE" && request.method !== "POST") {
      return response.status(405).json({ error: "Use DELETE or POST method" });
    }

    const { productId } = request.body;
    if (!productId) return response.status(400).json({ error: "Missing productId" });

    // Verify seller role
    const { uid: userId, user } = await verifySellerRole(request);

    const productRef = admin.firestore().collection("products").doc(productId);
    const productDoc = await productRef.get();

    if (!productDoc.exists) {
      return response.status(404).json({ error: "Product not found" });
    }

    const productData = productDoc.data();
    if (productData.sellerId !== userId) {
      return response.status(403).json({ error: "Unauthorized to delete this product" });
    }

    // Soft delete product
    await productRef.update({
      status: "inactive",
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info(`Product ${productId} marked inactive by ${userId}`);
    return response.json({
      success: true,
      message: "Product marked inactive",
      productId,
    });
  } catch (error) {
    logger.error("Error deleting product:", error);
    return response.status(500).json({ error: "Failed to delete product", details: error.message });
  }
});

