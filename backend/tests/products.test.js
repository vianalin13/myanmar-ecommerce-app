//Test file for product before integrating with real auth

const request = require("supertest");

const BASE_URL = "http://localhost:5001/myanmar-ecommerce-prototype/us-central1";

describe("Product API Tests", () => {
  let productId; // store dynamically created productId
  const mockSeller = "mockSeller123";
  const otherSeller = "otherSeller456";

  // CREATE PRODUCT
  test("Create product (valid)", async () => {
    const res = await request(BASE_URL)
      .post("/createProduct")
      .set("x-user-id", mockSeller)
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
  });

  test("Create product (invalid price)", async () => {
    const res = await request(BASE_URL)
      .post("/createProduct")
      .set("x-user-id", mockSeller)
      .send({
        name: "Bad Product",
        price: -100,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid price/);
  });

  // UPDATE PRODUCT
  test("Update product (authorized seller)", async () => {
    const res = await request(BASE_URL)
      .patch("/updateProduct")
      .set("x-user-id", mockSeller)
      .send({
        productId,
        name: "Updated Jest Product",
        price: 15000,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedFields.name).toBe("Updated Jest Product");
  });

  test("Update product (unauthorized seller)", async () => {
    const res = await request(BASE_URL)
      .patch("/updateProduct")
      .set("x-user-id", otherSeller)
      .send({
        productId,
        name: "Hacker Name",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  // GET SELLER PRODUCTS
  test("Get seller products", async () => {
    const res = await request(BASE_URL)
      .get("/getSellerProducts")
      .set("x-user-id", mockSeller);

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
    const res = await request(BASE_URL)
      .delete("/deleteProduct")
      .set("x-user-id", mockSeller)
      .send({ productId });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("Delete product (unauthorized seller)", async () => {
    const res = await request(BASE_URL)
      .delete("/deleteProduct")
      .set("x-user-id", otherSeller)
      .send({ productId });

    expect(res.statusCode).toBe(403);
  });

  afterAll(async () => {
  if (productId) {
    await request(BASE_URL)
      .delete("/deleteProduct")
      .set("x-user-id", mockSeller)
      .send({ productId });
    console.log(`Cleaned up test product: ${productId}`);
  }
  });
});

