/**
 * UPDATE PRODUCT
 * Allows a seller to update their product listing.
 * 
 * FUNCTION FLOW:
 * 1. VALIDATION: HTTP method, productId, field validation
 * 2. AUTHORIZATION: Verify seller role and product ownership
 * 3. VALIDATION: Check product exists and seller owns it
 * 4. UPDATE: Update allowed fields (name, price, stock, category, description, status)
 * 5. RESPONSE: Return success with updated fields
 */

const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifySellerRole } = require("../auth");

exports.updateProduct = onRequest(async (request, response) => {
  try {
    if (request.method !== "PATCH" && request.method !== "POST") {
      return response.status(405).json({ error: "Use PATCH or POST method" });
    }

    const { productId, name, price, stock, category, description, status } = request.body;
    if (!productId) {
      return response.status(400).json({ error: "Missing productId" });
    }

    // Verify seller role
    const { uid: userId, user } = await verifySellerRole(request);

    const productRef = admin.firestore().collection("products").doc(productId);
    const productDoc = await productRef.get();

    // Check if product exists
    if (!productDoc.exists) {
      return response.status(404).json({ error: "Product not found" });
    }

    // Check if seller owns the product
    const productData = productDoc.data();
    if (productData.sellerId !== userId) {
      return response.status(403).json({ error: "Unauthorized: not your product" });
    }

    // Only update allowed fields
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (price !== undefined) updateData.price = price;
    if (stock !== undefined) updateData.stock = stock;
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    
    // Validate status if provided (must be "active" or "inactive")
    if (status !== undefined) {
      if (status !== "active" && status !== "inactive") {
        return response.status(400).json({ error: "Invalid status: must be 'active' or 'inactive'" });
      }
      updateData.status = status;
    }
    
    updateData.updatedAt = FieldValue.serverTimestamp();

    await productRef.update(updateData);

    logger.info(`Product ${productId} updated by ${userId}`);
    return response.json({
      success: true,
      message: "Product updated successfully",
      updatedFields: updateData,
    });
  } catch (error) {
    logger.error("Error updating product:", error);
    return response.status(500).json({
      error: "Failed to update product",
      details: error.message,
    });
  }
});

