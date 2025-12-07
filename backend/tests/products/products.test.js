/**
 * PRODUCT API TESTS
 * Tests product CRUD operations with proper authentication
 */

const request = require("supertest");
const { BASE_URL } = require("../testSetup");
const { createAuthUserAndGetToken } = require("../auth/authHelpers");
const { cleanupTestData } = require("../cleanupHelpers");
const { createTestProduct } = require("./productHelpers");

describe("Product API Tests", () => {
  let sellerUid;
  let otherSellerUid;
  let sellerToken;
  let otherSellerToken;
  let productId;
  let productIds = [];

  // Setup before each test
  beforeEach(async () => {
    const timestamp = Date.now();
    sellerUid = `TEST_SELLER_${timestamp}`;
    otherSellerUid = `TEST_OTHER_SELLER_${timestamp}`;

    // Create sellers with proper authentication
    sellerToken = await createAuthUserAndGetToken(sellerUid, "seller", "verified");
    otherSellerToken = await createAuthUserAndGetToken(otherSellerUid, "seller", "verified");
  }, 30000);

  // Cleanup after each test
  afterEach(async () => {
    await cleanupTestData({
      sellerUid,
      productIds,
    });
    // Cleanup other seller if it exists
    if (otherSellerUid) {
      await cleanupTestData({
        sellerUid: otherSellerUid,
      });
    }
    productIds = [];
  }, 30000);

  // CREATE PRODUCT
  test("Create product (valid)", async () => {
    const res = await request(BASE_URL)
      .post("/createProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        name: "Jest Test Product",
        price: 10000,
        stock: 10,
        category: "Fashion",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.productId).toBeDefined();

    productId = res.body.productId;
    productIds.push(productId);
  });

  test("Create product (invalid price)", async () => {
    const res = await request(BASE_URL)
      .post("/createProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        name: "Bad Product",
        price: -100,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid price/);
  });

  // UPDATE PRODUCT
  test("Update product (authorized seller)", async () => {
    // First create a product
    const createRes = await request(BASE_URL)
      .post("/createProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        name: "Original Product",
        price: 10000,
        stock: 10,
        category: "Fashion",
      });
    
    const testProductId = createRes.body.productId;
    productIds.push(testProductId);

    // Then update it
    const res = await request(BASE_URL)
      .patch("/updateProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        productId: testProductId,
        name: "Updated Jest Product",
        price: 15000,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedFields.name).toBe("Updated Jest Product");
  });

  test("Update product (unauthorized seller)", async () => {
    // First create a product with first seller
    const createRes = await request(BASE_URL)
      .post("/createProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        name: "Original Product",
        price: 10000,
        stock: 10,
        category: "Fashion",
      });
    
    const testProductId = createRes.body.productId;
    productIds.push(testProductId);

    // Try to update with other seller (should fail)
    const res = await request(BASE_URL)
      .patch("/updateProduct")
      .set("Authorization", `Bearer ${otherSellerToken}`)
      .send({
        productId: testProductId,
        name: "Hacker Name",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  // GET SELLER PRODUCTS
  test("Get seller products", async () => {
    // First create a product
    const createRes = await request(BASE_URL)
      .post("/createProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        name: "Test Product",
        price: 10000,
        stock: 10,
        category: "Fashion",
      });
    
    productIds.push(createRes.body.productId);

    const res = await request(BASE_URL)
      .get("/getSellerProducts")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.products)).toBe(true);
  });

  // GET PUBLIC PRODUCTS
  test("Get public products (active only)", async () => {
    const res = await request(BASE_URL).get("/getPublicProducts");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.products)).toBe(true);
  });

  // DELETE PRODUCT
  test("Delete product (authorized seller)", async () => {
    // First create a product
    const createRes = await request(BASE_URL)
      .post("/createProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        name: "Product to Delete",
        price: 10000,
        stock: 10,
        category: "Fashion",
      });
    
    const testProductId = createRes.body.productId;

    const res = await request(BASE_URL)
      .delete("/deleteProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ productId: testProductId });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("Delete product (unauthorized seller)", async () => {
    // First create a product with first seller
    const createRes = await request(BASE_URL)
      .post("/createProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        name: "Product to Delete",
        price: 10000,
        stock: 10,
        category: "Fashion",
      });
    
    const testProductId = createRes.body.productId;
    productIds.push(testProductId);

    // Try to delete with other seller (should fail)
    const res = await request(BASE_URL)
      .delete("/deleteProduct")
      .set("Authorization", `Bearer ${otherSellerToken}`)
      .send({ productId: testProductId });

    expect(res.statusCode).toBe(403);
  });
});

