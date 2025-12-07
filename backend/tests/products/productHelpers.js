/**
 * PRODUCT HELPERS
 * shared functions for creating test products
 */

const request = require("supertest");
const { BASE_URL } = require("../testSetup");

/**
 * create test product
 * 
 * @param {string} sellerToken - seller authentication token
 * @param {Object} options - product options
 * @param {string} options.name - product name (default: "test product")
 * @param {number} options.price - product price (default: 10000)
 * @param {number} options.stock - product stock (default: 100)
 * @param {string} options.category - product category (default: "test")
 * @param {string} options.description - product description (optional)
 * @param {string} options.imageURL - product image URL (optional)
 * @returns {Promise<string>} product ID
 */
async function createTestProduct(sellerToken, options = {}) {
  const {
    name = "Test Product",
    price = 10000,
    stock = 100,
    category = "Test",
    description = undefined,
    imageURL = undefined,
  } = options;

  const productData = {
    name,
    price,
    stock,
    category,
  };

  if (description !== undefined) {
    productData.description = description;
  }

  if (imageURL !== undefined) {
    productData.imageURL = imageURL;
  }

  const res = await request(BASE_URL)
    .post("/createProduct")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send(productData);

  if (res.statusCode !== 200) {
    //log full response for debugging
    console.error("Product creation failed. Status:", res.statusCode);
    console.error("Response body:", JSON.stringify(res.body, null, 2));
    console.error("Request data:", JSON.stringify(productData, null, 2));
    const errorMsg = res.body.details || res.body.error || res.body.message || "Unknown error";
    throw new Error(`Failed to create product: ${errorMsg} (Status: ${res.statusCode})`);
  }

  return res.body.productId;
}

/**
 * create multiple test products
 * 
 * @param {string} sellerToken - seller authentication token
 * @param {number} count - number of products to create (default: 1)
 * @param {Object} baseOptions - base product options
 * @returns {Promise<string[]>} array of product IDs
 */
async function createMultipleProducts(sellerToken, count = 1, baseOptions = {}) {
  const productIds = [];

  for (let i = 0; i < count; i++) {
    const options = {
      ...baseOptions,
      name: baseOptions.name || `Test Product ${i + 1}`,
    };
    const productId = await createTestProduct(sellerToken, options);
    productIds.push(productId);
  }

  return productIds;
}

module.exports = {
  createTestProduct,
  createMultipleProducts,
};

