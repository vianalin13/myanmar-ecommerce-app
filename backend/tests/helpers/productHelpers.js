/**
 * PRODUCT HELPERS
 * Shared functions for creating test products
 */

const request = require("supertest");
const { BASE_URL } = require("./testSetup");

/**
 * Create test product
 * 
 * @param {string} sellerToken - Seller authentication token
 * @param {Object} options - Product options
 * @param {string} options.name - Product name (default: "Test Product")
 * @param {number} options.price - Product price (default: 10000)
 * @param {number} options.stock - Product stock (default: 100)
 * @param {string} options.category - Product category (default: "Test")
 * @param {string} options.description - Product description (optional)
 * @param {string} options.imageURL - Product image URL (optional)
 * @returns {Promise<string>} Product ID
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
    throw new Error(`Failed to create product: ${res.body.error || res.body.details}`);
  }

  return res.body.productId;
}

/**
 * Create multiple test products
 * 
 * @param {string} sellerToken - Seller authentication token
 * @param {number} count - Number of products to create (default: 1)
 * @param {Object} baseOptions - Base product options
 * @returns {Promise<string[]>} Array of product IDs
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

