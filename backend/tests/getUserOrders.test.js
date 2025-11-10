/**
 * GET USER ORDERS TEST SUITE
 * Tests the getUserOrders function with proper isolation and cleanup
 * 
 * Features:
 * - Phone number authentication (Myanmar format)
 * - Test isolation (beforeEach/afterEach)
 * - Complete cleanup to prevent repeated run failures
 * - Tests buyer orders, seller orders (automatic role detection)
 * - Note: Status filtering is now handled on frontend, not tested here
 */

const request = require("supertest");
const { firestore, BASE_URL } = require("./helpers/testSetup");
const { createAuthUserAndGetToken } = require("./helpers/authHelpers");
const { cleanupTestData } = require("./helpers/cleanupHelpers");
const { createTestProduct } = require("./helpers/productHelpers");
const { createOrderWithStatus } = require("./helpers/orderHelpers");

// ============================================================================
// GET USER ORDERS TESTS
// ============================================================================

describe("Get User Orders API Tests", () => {
  let buyerUid;
  let sellerUid;
  let buyerToken;
  let sellerToken;
  let productId;
  let productIds = [];
  let orderIds = [];

  // Setup before each test (isolation)
  beforeEach(async () => {
    const timestamp = Date.now();
    buyerUid = `TEST_BUYER_${timestamp}`;
    sellerUid = `TEST_SELLER_${timestamp}`;

    // Create users with phone number auth
    buyerToken = await createAuthUserAndGetToken(buyerUid, "buyer", "unverified");
    sellerToken = await createAuthUserAndGetToken(sellerUid, "seller", "verified");

    // Create test product using shared helper
    productId = await createTestProduct(sellerToken, {
      name: "Test Product",
      price: 10000,
      stock: 100,
      category: "Test",
    });
    productIds.push(productId);
  }, 30000); // Increase timeout for setup

  // Cleanup after each test
  afterEach(async () => {
    await cleanupTestData({
      buyerUid,
      sellerUid,
      productIds,
      orderIds,
    });
    orderIds = [];
    productIds = [];
  }, 30000); // Increase timeout for cleanup

  // ========================================================================
  // HELPER: Create order for testing (wrapper to track orderIds)
  // ========================================================================
  async function createTestOrder(paymentMethod = "COD", status = "pending") {
    const orderId = await createOrderWithStatus({
      buyerToken,
      sellerToken,
      sellerId: sellerUid,
      products: [{ productId: productId, quantity: 2 }],
      paymentMethod: paymentMethod,
      status: status,
      trackingNumber: status === "shipped" || status === "delivered" ? "TRACK123456789" : undefined,
      proofOfDelivery: status === "delivered" ? { otpCode: "123456" } : undefined,
    });
    if (orderId) {
      orderIds.push(orderId);
    }
    return orderId;
  }

  // ========================================================================
  // BUYER ORDERS TESTS
  // ========================================================================

  test("Get user orders (as buyer - no orders)", async () => {
    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orders).toEqual([]);
    expect(res.body.count).toBe(0);
    expect(res.body.message).toBe("No orders found");
  }, 30000);

  test("Get user orders (as buyer - single order)", async () => {
    const orderId = await createTestOrder();

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].orderId).toBe(orderId);
    expect(res.body.orders[0].buyerId).toBe(buyerUid);
    expect(res.body.orders[0].sellerId).toBe(sellerUid);
    expect(res.body.orders[0].userRole).toBe("buyer");
  }, 30000);

  test("Get user orders (as buyer - multiple orders)", async () => {
    const orderId1 = await createTestOrder("COD", "pending");
    const orderId2 = await createTestOrder("KBZPay", "confirmed");
    const orderId3 = await createTestOrder("WavePay", "shipped");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(3);
    expect(res.body.orders).toHaveLength(3);
    
    // Verify all orders belong to buyer
    res.body.orders.forEach(order => {
      expect(order.buyerId).toBe(buyerUid);
      expect(order.userRole).toBe("buyer");
    });

    // Verify orders are sorted by createdAt desc (most recent first)
    // Note: HTTP responses serialize Firestore Timestamps as plain objects
    // We verify sorting by checking that createdAt fields exist and are in descending order
    const timestamps = res.body.orders.map(o => {
      const createdAt = o.createdAt;
      // Handle Firestore Timestamp serialization from HTTP response
      if (createdAt?._seconds !== undefined) {
        return createdAt._seconds * 1000 + (createdAt._nanoseconds || 0) / 1000000;
      }
      if (createdAt?.seconds !== undefined) {
        return createdAt.seconds * 1000 + (createdAt.nanoseconds || 0) / 1000000;
      }
      // Fallback: try to parse as Date string
      if (typeof createdAt === "string") {
        return new Date(createdAt).getTime();
      }
      // If createdAt is an object with toDate or valueOf
      if (createdAt && typeof createdAt.valueOf === "function") {
        return new Date(createdAt.valueOf()).getTime();
      }
      return 0;
    });
    
    // Verify timestamps are in descending order (most recent first)
    for (let i = 0; i < timestamps.length - 1; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
    }
    
    // Also verify all orders have createdAt field
    res.body.orders.forEach(order => {
      expect(order.createdAt).toBeDefined();
    });
  }, 30000);

  test("Get user orders (as buyer - orders with different statuses)", async () => {
    await createTestOrder("COD", "pending");
    await createTestOrder("KBZPay", "confirmed");
    await createTestOrder("WavePay", "shipped");
    await createTestOrder("COD", "delivered");
    await createTestOrder("KBZPay", "cancelled");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(5);
    expect(res.body.orders).toHaveLength(5);
    
    // Verify all orders belong to buyer (status filtering is now frontend responsibility)
    res.body.orders.forEach(order => {
      expect(order.buyerId).toBe(buyerUid);
      expect(order.userRole).toBe("buyer");
    });

    // Verify we have orders with different statuses
    const statuses = res.body.orders.map(o => o.status);
    expect(statuses).toContain("pending");
    expect(statuses).toContain("confirmed");
    expect(statuses).toContain("shipped");
    expect(statuses).toContain("delivered");
    expect(statuses).toContain("cancelled");
  }, 30000);

  // ========================================================================
  // SELLER ORDERS TESTS
  // ========================================================================

  test("Get user orders (as seller - no orders)", async () => {
    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orders).toEqual([]);
    expect(res.body.count).toBe(0);
    expect(res.body.message).toBe("No orders found");
  }, 30000);

  test("Get user orders (as seller - single order)", async () => {
    const orderId = await createTestOrder();

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].orderId).toBe(orderId);
    expect(res.body.orders[0].sellerId).toBe(sellerUid);
    expect(res.body.orders[0].buyerId).toBe(buyerUid);
    expect(res.body.orders[0].userRole).toBe("seller");
  }, 30000);

  test("Get user orders (as seller - multiple orders)", async () => {
    const orderId1 = await createTestOrder("COD", "pending");
    const orderId2 = await createTestOrder("KBZPay", "confirmed");
    const orderId3 = await createTestOrder("WavePay", "shipped");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(3);
    expect(res.body.orders).toHaveLength(3);
    
    // Verify all orders belong to seller
    res.body.orders.forEach(order => {
      expect(order.sellerId).toBe(sellerUid);
      expect(order.userRole).toBe("seller");
    });
  }, 30000);

  test("Get user orders (as seller - orders with different statuses)", async () => {
    await createTestOrder("COD", "pending");
    await createTestOrder("KBZPay", "confirmed");
    await createTestOrder("WavePay", "shipped");
    await createTestOrder("COD", "delivered");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(4);
    expect(res.body.orders).toHaveLength(4);
    
    // Verify all orders belong to seller (status filtering is now frontend responsibility)
    res.body.orders.forEach(order => {
      expect(order.sellerId).toBe(sellerUid);
      expect(order.userRole).toBe("seller");
    });
  }, 30000);

  // ========================================================================
  // AUTHORIZATION TESTS
  // ========================================================================

  test("Get user orders (no auth token)", async () => {
    const res = await request(BASE_URL)
      .get("/getUserOrders");

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  test("Get user orders (invalid auth token)", async () => {
    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", "Bearer invalidToken123");

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  test("Get user orders (user with no role)", async () => {
    // Create user without role (this shouldn't happen in practice, but test edge case)
    const noRoleUid = `TEST_NO_ROLE_${Date.now()}`;
    const noRoleToken = await createAuthUserAndGetToken(noRoleUid, "buyer", "unverified");
    
    // Manually remove role from user document to simulate edge case
    await firestore.collection("users").doc(noRoleUid).update({ role: null });

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${noRoleToken}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/User must have a valid role/);

    // Cleanup
    await cleanupTestData({ buyerUid: noRoleUid });
  }, 30000);

  test("Get user orders (user with invalid role)", async () => {
    // Create user with invalid role
    const invalidRoleUid = `TEST_INVALID_ROLE_${Date.now()}`;
    const invalidRoleToken = await createAuthUserAndGetToken(invalidRoleUid, "buyer", "unverified");
    
    // Manually set invalid role
    await firestore.collection("users").doc(invalidRoleUid).update({ role: "invalid_role" });

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${invalidRoleToken}`);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/User must have a valid role/);

    // Cleanup
    await cleanupTestData({ buyerUid: invalidRoleUid });
  }, 30000);

  // ========================================================================
  // HTTP METHOD TESTS
  // ========================================================================

  test("Get user orders (wrong HTTP method - POST)", async () => {
    const res = await request(BASE_URL)
      .post("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({});

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use GET method/);
  }, 30000);

  test("Get user orders (wrong HTTP method - PATCH)", async () => {
    const res = await request(BASE_URL)
      .patch("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({});

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use GET method/);
  }, 30000);

  // ========================================================================
  // EDGE CASES
  // ========================================================================

  test("Get user orders (query parameters ignored)", async () => {
    // Query parameters are ignored - function uses user's role from database
    await createTestOrder("COD", "pending");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "invalid_role", // Should be ignored
        orderStatus: "pending", // Should be ignored
        randomParam: "value", // Should be ignored
      });

    // Should still return buyer orders (ignores query params)
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.orders[0].buyerId).toBe(buyerUid);
    expect(res.body.orders[0].userRole).toBe("buyer");
  }, 30000);

  test("Get user orders (multiple buyers - isolation)", async () => {
    // Create orders for first buyer
    await createTestOrder("COD", "pending");
    await createTestOrder("KBZPay", "confirmed");

    // Create second buyer
    const buyer2Uid = `TEST_BUYER_2_${Date.now()}`;
    const buyer2Token = await createAuthUserAndGetToken(buyer2Uid, "buyer", "unverified");

    // Second buyer creates an order
    const orderRes = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyer2Token}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "456 Test Ave",
          city: "Yangon",
          phone: "+959987654321",
        },
      });
    const buyer2OrderId = orderRes.body.orderId;
    orderIds.push(buyer2OrderId);

    // First buyer should only see their orders
    const res1 = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res1.statusCode).toBe(200);
    expect(res1.body.count).toBe(2);
    res1.body.orders.forEach(order => {
      expect(order.buyerId).toBe(buyerUid);
    });

    // Second buyer should only see their order
    const res2 = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyer2Token}`);

    expect(res2.statusCode).toBe(200);
    expect(res2.body.count).toBe(1);
    expect(res2.body.orders[0].orderId).toBe(buyer2OrderId);
    expect(res2.body.orders[0].buyerId).toBe(buyer2Uid);

    // Cleanup
    await cleanupTestData({
      buyerUid: buyer2Uid,
      orderIds: [buyer2OrderId],
    });
  }, 30000);

  test("Get user orders (multiple sellers - isolation)", async () => {
    // Create orders with first seller
    await createTestOrder("COD", "pending");

    // Create second seller and product
    const seller2Uid = `TEST_SELLER_2_${Date.now()}`;
    const seller2Token = await createAuthUserAndGetToken(seller2Uid, "seller", "verified");

    const productRes2 = await request(BASE_URL)
      .post("/createProduct")
      .set("Authorization", `Bearer ${seller2Token}`)
      .send({
        name: "Seller 2 Product",
        price: 20000,
        stock: 50,
        category: "Test",
      });
    const productId2 = productRes2.body.productId;
    productIds.push(productId2);

    // Buyer creates order with second seller
    const orderRes = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: seller2Uid,
        products: [{ productId: productId2, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "456 Test Ave",
          city: "Yangon",
          phone: "+959987654321",
        },
      });
    const seller2OrderId = orderRes.body.orderId;
    orderIds.push(seller2OrderId);

    // First seller should only see their order
    const res1 = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(res1.statusCode).toBe(200);
    expect(res1.body.count).toBe(1);
    expect(res1.body.orders[0].sellerId).toBe(sellerUid);

    // Second seller should only see their order
    const res2 = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${seller2Token}`);

    expect(res2.statusCode).toBe(200);
    expect(res2.body.count).toBe(1);
    expect(res2.body.orders[0].orderId).toBe(seller2OrderId);
    expect(res2.body.orders[0].sellerId).toBe(seller2Uid);

    // Cleanup
    await cleanupTestData({
      sellerUid: seller2Uid,
    });
  }, 30000);
});
