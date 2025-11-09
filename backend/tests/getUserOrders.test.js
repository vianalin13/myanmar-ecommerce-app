/**
 * GET USER ORDERS TEST SUITE
 * Tests the getUserOrders function with proper isolation and cleanup
 * 
 * Features:
 * - Phone number authentication (Myanmar format)
 * - Test isolation (beforeEach/afterEach)
 * - Complete cleanup to prevent repeated run failures
 * - Tests buyer orders, seller orders, role filtering, status filtering
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
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "buyer",
      });

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
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "buyer",
      });

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
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "buyer",
      });

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

  test("Get user orders (as buyer - filter by status: pending)", async () => {
    await createTestOrder("COD", "pending");
    await createTestOrder("KBZPay", "confirmed");
    await createTestOrder("WavePay", "pending");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "buyer",
        orderStatus: "pending",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.orders).toHaveLength(2);
    
    // Verify all orders are pending
    res.body.orders.forEach(order => {
      expect(order.status).toBe("pending");
      expect(order.buyerId).toBe(buyerUid);
    });
  }, 30000);

  test("Get user orders (as buyer - filter by status: confirmed)", async () => {
    await createTestOrder("COD", "pending");
    await createTestOrder("KBZPay", "confirmed");
    await createTestOrder("WavePay", "confirmed");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "buyer",
        orderStatus: "confirmed",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.orders).toHaveLength(2);
    
    // Verify all orders are confirmed
    res.body.orders.forEach(order => {
      expect(order.status).toBe("confirmed");
    });
  }, 30000);

  test("Get user orders (as buyer - filter by status: shipped)", async () => {
    await createTestOrder("COD", "pending");
    await createTestOrder("KBZPay", "shipped");
    await createTestOrder("WavePay", "delivered");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "buyer",
        orderStatus: "shipped",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].status).toBe("shipped");
  }, 30000);

  test("Get user orders (as buyer - filter by status: cancelled)", async () => {
    await createTestOrder("COD", "pending");
    const cancelledOrderId = await createTestOrder("KBZPay", "cancelled");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "buyer",
        orderStatus: "cancelled",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].orderId).toBe(cancelledOrderId);
    expect(res.body.orders[0].status).toBe("cancelled");
  }, 30000);

  // ========================================================================
  // SELLER ORDERS TESTS
  // ========================================================================

  test("Get user orders (as seller - no orders)", async () => {
    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${sellerToken}`)
      .query({
        role: "seller",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orders).toEqual([]);
    expect(res.body.count).toBe(0);
  }, 30000);

  test("Get user orders (as seller - single order)", async () => {
    const orderId = await createTestOrder();

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${sellerToken}`)
      .query({
        role: "seller",
      });

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
      .set("Authorization", `Bearer ${sellerToken}`)
      .query({
        role: "seller",
      });

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

  test("Get user orders (as seller - filter by status)", async () => {
    await createTestOrder("COD", "pending");
    await createTestOrder("KBZPay", "confirmed");
    await createTestOrder("WavePay", "pending");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${sellerToken}`)
      .query({
        role: "seller",
        orderStatus: "pending",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.orders).toHaveLength(2);
    
    // Verify all orders are pending and belong to seller
    res.body.orders.forEach(order => {
      expect(order.status).toBe("pending");
      expect(order.sellerId).toBe(sellerUid);
    });
  }, 30000);

  test("Get user orders (as seller - buyer is not a seller)", async () => {
    // Buyer tries to get seller orders (should fail)
    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "seller",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized: user is not a seller/);
  }, 30000);

  // ========================================================================
  // ALL ORDERS TESTS (no role specified)
  // ========================================================================

  test("Get user orders (no role - buyer gets all buyer orders)", async () => {
    await createTestOrder("COD", "pending");
    await createTestOrder("KBZPay", "confirmed");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`);
      // No role query param

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.orders).toHaveLength(2);
    
    // Verify all orders belong to buyer
    res.body.orders.forEach(order => {
      expect(order.buyerId).toBe(buyerUid);
      expect(order.userRole).toBe("buyer");
    });
  }, 30000);

  test("Get user orders (no role - seller gets all seller orders)", async () => {
    await createTestOrder("COD", "pending");
    await createTestOrder("KBZPay", "confirmed");

    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${sellerToken}`);
      // No role query param

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.orders).toHaveLength(2);
    
    // Verify all orders belong to seller
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
      .get("/getUserOrders")
      .query({
        role: "buyer",
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  test("Get user orders (invalid auth token)", async () => {
    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", "Bearer invalidToken123")
      .query({
        role: "buyer",
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  // ========================================================================
  // HTTP METHOD TESTS
  // ========================================================================

  test("Get user orders (wrong HTTP method - POST)", async () => {
    const res = await request(BASE_URL)
      .post("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        role: "buyer",
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use GET method/);
  }, 30000);

  test("Get user orders (wrong HTTP method - PATCH)", async () => {
    const res = await request(BASE_URL)
      .patch("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        role: "buyer",
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use GET method/);
  }, 30000);

  // ========================================================================
  // EDGE CASES
  // ========================================================================

  test("Get user orders (invalid role parameter)", async () => {
    // Invalid role should still work (treats as "all orders")
    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "invalid_role",
      });

    // Should return buyer orders (because role doesn't match "buyer" or "seller")
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  }, 30000);

  test("Get user orders (invalid status filter)", async () => {
    await createTestOrder("COD", "pending");

    // Invalid status filter - should return empty array (no matches)
    const res = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "buyer",
        orderStatus: "invalid_status",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(0);
    expect(res.body.orders).toEqual([]);
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
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        role: "buyer",
      });

    expect(res1.statusCode).toBe(200);
    expect(res1.body.count).toBe(2);
    res1.body.orders.forEach(order => {
      expect(order.buyerId).toBe(buyerUid);
    });

    // Second buyer should only see their order
    const res2 = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${buyer2Token}`)
      .query({
        role: "buyer",
      });

    expect(res2.statusCode).toBe(200);
    expect(res2.body.count).toBe(1);
    expect(res2.body.orders[0].orderId).toBe(buyer2OrderId);
    expect(res2.body.orders[0].buyerId).toBe(buyer2Uid);

    // Cleanup
    await cleanupTestData({
      buyerUid: buyer2Uid,
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
      .set("Authorization", `Bearer ${sellerToken}`)
      .query({
        role: "seller",
      });

    expect(res1.statusCode).toBe(200);
    expect(res1.body.count).toBe(1);
    expect(res1.body.orders[0].sellerId).toBe(sellerUid);

    // Second seller should only see their order
    const res2 = await request(BASE_URL)
      .get("/getUserOrders")
      .set("Authorization", `Bearer ${seller2Token}`)
      .query({
        role: "seller",
      });

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

