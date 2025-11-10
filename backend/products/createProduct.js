/**
 * CREATE PRODUCT
 * Allows a seller to create a new product listing.
 * 
 * FUNCTION FLOW:
 * 1. VALIDATION: Required fields (name, price), price/stock validation
 * 2. AUTHORIZATION: Verify seller role
 * 3. CREATE: Add product to Firestore with sellerId, status "active"
 * 4. RESPONSE: Return productId
 */

const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifySellerRole } = require("../auth");

exports.createProduct = onRequest(async (request, response) => {
  try {
    const { name, description, price, stock, category, imageURL } = request.body;

    // Required field check
    if (!name || price === undefined) {
      return response.status(400).json({ error: "Missing required fields" });
    }

    // Price validation
    if (typeof price !== "number" || price < 0) {
      return response.status(400).json({ error: "Invalid price: must be a positive number" });
    }

    // Stock validation
    if (stock !== undefined && (typeof stock !== "number" || stock < 0)) {
      return response.status(400).json({ error: "Invalid stock: must be a positive number" });
    }

    // Verify seller role
    const { uid: userId, user } = await verifySellerRole(request);

    // Construct product data
    const productData = {
      sellerId: userId,
      name,
      description: description || "",
      price: Number(price),
      stock: Number(stock) || 0,
      category: category || "Uncategorized",
      imageURL: imageURL || null,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Add to Firestore
    const productRef = await admin.firestore().collection("products").add(productData);
    await productRef.update({ productId: productRef.id });

    logger.info(`Product created: ${productRef.id} by seller ${userId}`);

    return response.json({
      success: true,
      message: "Product created successfully",
      productId: productRef.id,
    });
  } catch (error) {
    logger.error("Error creating product:", error);
    return response.status(500).json({
      error: "Failed to create product",
      details: error.message,
    });
  }
});

