/**
 * PRODUCT MANAGEMENT SYSTEM (Seller Functions)
 * ---------------------------------------------
 * Firestore Collection: products/{productId}
 *
 * Product Schema:
 * {
 *   productId: string (auto-generated),
 *   sellerId: string,
 *   name: string,
 *   description: string,
 *   price: number,
 *   stock: number,
 *   category: string,
 *   imageURL: string,
 *   status: "active" | "inactive",
 *   createdAt: timestamp,
 *   updatedAt: timestamp
 * }
 */

const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifySellerRole } = require("../auth");

//create product
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

    //replaced Auth
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


//update/edit product (seller only)
exports.updateProduct = onRequest(async (request, response) => {
  try {
    if (request.method !== "PATCH" && request.method !== "POST") {
      return response.status(405).json({ error: "Use PATCH or POST method" });
    }

    const { productId, name, price, stock, category, description, status } = request.body;
    if (!productId) {
      return response.status(400).json({ error: "Missing productId" });
    }

    // auth 
    const { uid: userId, user } = await verifySellerRole(request);

    const productRef = admin.firestore().collection("products").doc(productId);
    const productDoc = await productRef.get();

    //check if product exists
    if (!productDoc.exists) {
      return response.status(404).json({ error: "Product not found" });
    }
    //check if seller owns the product
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


//DELETE (SOFT) PRODUCT: Sets product status to "inactive"
exports.deleteProduct = onRequest(async (request, response) => {
  try {
    if (request.method !== "DELETE" && request.method !== "POST") {
      return response.status(405).json({ error: "Use DELETE or POST method" });
    }

    const { productId } = request.body;
    if (!productId) return response.status(400).json({ error: "Missing productId" });

    // verify seller
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
    // Note: Orders store product snapshots (name, price, image) at creation time,
    // so deleting a product does not affect existing orders. Orders are independent
    // and contain all necessary product information for fulfillment.
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


//GET SELLER PRODUCTS - Fetches all listings by seller
exports.getSellerProducts = onRequest(async (request, response) => {
  try {
    if (request.method !== "GET") {
      return response.status(405).json({ error: "Use GET method" });
    }

    // verify seller
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

//GET ALL ACTIVE/PUBLIC PRODUCTS - For buyers
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
