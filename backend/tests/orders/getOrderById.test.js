/**
 * GET ORDER BY ID TEST SUITE
 * Tests the getOrderById function with proper isolation and cleanup
 * 
 * Features:
 * - Phone number authentication (Myanmar format)
 * - Test isolation (beforeEach/afterEach)
 * - Complete cleanup to prevent repeated run failures
 * - Tests authorization (buyer, seller, admin), validation, error cases
 */

const request = require("supertest");
const { firestore, BASE_URL } = require("../testSetup");
const { createAuthUserAndGetToken } = require("../auth/authHelpers");
const { cleanupTestData } = require("../cleanupHelpers");
const { createTestProduct } = require("../products/productHelpers");
const { createTestOrder } = require("./orderHelpers");
const { createTestChat } = require("../chat/chatHelpers");

// ============================================================================
// GET ORDER BY ID TESTS
// ============================================================================

describe("Get Order By ID API Tests", () => {
  let buyerUid;
  let sellerUid;
  let adminUid;
  let buyerToken;
  let sellerToken;
  let adminToken;
  let productId;
  let productIds = [];
  let orderIds = [];
  let chatIds = [];

  // Setup before each test (isolation)
  beforeEach(async () => {
    const timestamp = Date.now();
    buyerUid = `TEST_BUYER_${timestamp}`;
    sellerUid = `TEST_SELLER_${timestamp}`;
    adminUid = `TEST_ADMIN_${timestamp}`;

    // Create users with phone number auth
    buyerToken = await createAuthUserAndGetToken(buyerUid, "buyer", "unverified");
    sellerToken = await createAuthUserAndGetToken(sellerUid, "seller", "verified");
    adminToken = await createAuthUserAndGetToken(adminUid, "admin", "unverified");

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
      adminUid,
      productIds,
      orderIds,
      chatIds,
    });
    orderIds = [];
    productIds = [];
    chatIds = [];
  }, 30000); // Increase timeout for cleanup

  // ========================================================================
  // HELPER: Create order for testing (wrapper to track orderIds)
  // ========================================================================
  async function createTestOrderLocal(paymentMethod = "COD") {
    const orderId = await createTestOrder({
      buyerToken,
      sellerId: sellerUid,
      products: [{ productId: productId, quantity: 2 }],
      paymentMethod: paymentMethod,
    });
    if (orderId) {
      orderIds.push(orderId);
    }
    return orderId;
  }

  // ========================================================================
  // SUCCESS CASES: AUTHORIZATION
  // ========================================================================

  test("Get order by ID (as buyer - own order)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.orderId).toBe(orderId);
    expect(res.body.order.buyerId).toBe(buyerUid);
    expect(res.body.order.sellerId).toBe(sellerUid);
    expect(res.body.order.products).toBeDefined();
    expect(res.body.order.totalAmount).toBeDefined();
    expect(res.body.order.paymentMethod).toBeDefined();
    expect(res.body.order.status).toBeDefined();
    expect(res.body.order.paymentStatus).toBeDefined();
  }, 30000);

  test("Get order by ID (as seller - own order)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${sellerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.orderId).toBe(orderId);
    expect(res.body.order.buyerId).toBe(buyerUid);
    expect(res.body.order.sellerId).toBe(sellerUid);
  }, 30000);

  test("Get order by ID (as admin - any order)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.orderId).toBe(orderId);
  }, 30000);

  test("Get order by ID (order with all fields)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Update order status to shipped with tracking
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "shipped",
        trackingNumber: "TRACK123456789",
        trackingProvider: "myanmar_post",
      });

    // Confirm payment
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const order = res.body.order;
    
    // Verify all fields are present
    expect(order.orderId).toBe(orderId);
    expect(order.buyerId).toBe(buyerUid);
    expect(order.sellerId).toBe(sellerUid);
    expect(order.products).toBeDefined();
    expect(order.products).toHaveLength(1);
    expect(order.totalAmount).toBe(20000); // 2 * 10000
    expect(order.paymentMethod).toBe("KBZPay");
    expect(order.paymentStatus).toBe("paid");
    expect(order.status).toBe("shipped");
    expect(order.trackingNumber).toBe("TRACK123456789");
    expect(order.trackingProvider).toBe("myanmar_post");
    expect(order.deliveryAddress).toBeDefined();
    expect(order.deliveryAddress.street).toBe("123 Test St");
    expect(order.deliveryAddress.city).toBe("Yangon");
    expect(order.deliveryAddress.phone).toBe("+959123456789");
    expect(order.createdAt).toBeDefined();
    expect(order.updatedAt).toBeDefined();
    expect(order.paymentConfirmation).toBeDefined();
  }, 30000);

  // ========================================================================
  // AUTHORIZATION ERROR CASES
  // ========================================================================

  test("Get order by ID (unauthorized - other buyer)", async () => {
    const orderId = await createTestOrderLocal();

    // Create another buyer
    const otherBuyerUid = `TEST_OTHER_BUYER_${Date.now()}`;
    const otherBuyerToken = await createAuthUserAndGetToken(otherBuyerUid, "buyer", "unverified");

    // Other buyer tries to view order (should fail)
    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${otherBuyerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized/);

    // Cleanup
    await cleanupTestData({
      buyerUid: otherBuyerUid,
    });
  }, 30000);

  test("Get order by ID (unauthorized - other seller)", async () => {
    const orderId = await createTestOrderLocal();

    // Create another seller
    const otherSellerUid = `TEST_OTHER_SELLER_${Date.now()}`;
    const otherSellerToken = await createAuthUserAndGetToken(otherSellerUid, "seller", "verified");

    // Other seller tries to view order (should fail)
    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${otherSellerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized/);

    // Cleanup
    await cleanupTestData({
      sellerUid: otherSellerUid,
    });
  }, 30000);

  test("Get order by ID (no auth token)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  test("Get order by ID (invalid auth token)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", "Bearer invalidToken123")
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  // ========================================================================
  // VALIDATION ERROR CASES
  // ========================================================================

  test("Get order by ID (missing orderId)", async () => {
    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        // Missing orderId
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required parameter: orderId/);
  }, 30000);

  test("Get order by ID (order not found)", async () => {
    const fakeOrderId = "fakeOrderId123";

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: fakeOrderId,
      });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Order not found/);
  }, 30000);

  test("Get order by ID (empty orderId)", async () => {
    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: "",
      });

    // Empty string is treated as missing parameter (validation error)
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required parameter: orderId/);
  }, 30000);

  // ========================================================================
  // HTTP METHOD TESTS
  // ========================================================================

  test("Get order by ID (wrong HTTP method - POST)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .post("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use GET method/);
  }, 30000);

  test("Get order by ID (wrong HTTP method - PATCH)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .patch("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use GET method/);
  }, 30000);

  // ========================================================================
  // EDGE CASES
  // ========================================================================

  test("Get order by ID (order with chatId)", async () => {
    // Create a test chat between buyer and seller
    const chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);

    const orderRes = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
        chatId: chatId,
      });

    const orderId = orderRes.body.orderId;
    orderIds.push(orderId);

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.order.chatId).toBe(chatId);
    expect(res.body.order.orderSource).toBe("chat");
  }, 30000);

  test("Get order by ID (order with proof of delivery)", async () => {
    const orderId = await createTestOrderLocal("COD");

    // Update to delivered with proof
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "shipped",
        trackingNumber: "TRACK123456789",
      });

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: {
          photoURL: "https://example.com/photo.jpg",
          otpCode: "123456",
          deliveryNotes: "Delivered successfully",
        },
      });

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.order.proofOfDelivery).toBeDefined();
    expect(res.body.order.proofOfDelivery.photoURL).toBe("https://example.com/photo.jpg");
    expect(res.body.order.proofOfDelivery.otpCode).toBe("123456");
    expect(res.body.order.proofOfDelivery.deliveryNotes).toBe("Delivered successfully");
    expect(res.body.order.proofOfDelivery.confirmedBy).toBe(sellerUid);
    expect(res.body.order.deliveredAt).toBeDefined();
  }, 30000);

  test("Get order by ID (cancelled order)", async () => {
    const orderId = await createTestOrderLocal();

    // Cancel order
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.order.status).toBe("cancelled");
    expect(res.body.order.cancelledAt).toBeDefined();
  }, 30000);

  test("Get order by ID (refunded order)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment first
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Cancel the paid order (should automatically become refunded)
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.order.status).toBe("refunded");
    expect(res.body.order.paymentStatus).toBe("refunded");
  }, 30000);

  test("Get order by ID (order with multiple products)", async () => {
    // Create another product
    const productRes2 = await request(BASE_URL)
      .post("/createProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        name: "Test Product 2",
        price: 20000,
        stock: 50,
        category: "Test",
      });
    const productId2 = productRes2.body.productId;
    productIds.push(productId2);

    // Create order with multiple products
    const orderRes = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [
          { productId: productId, quantity: 2 },
          { productId: productId2, quantity: 1 },
        ],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    const orderId = orderRes.body.orderId;
    orderIds.push(orderId);

    const res = await request(BASE_URL)
      .get("/getOrderById")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.order.products).toHaveLength(2);
    expect(res.body.order.totalAmount).toBe(40000); // (2 * 10000) + (1 * 20000)
  }, 30000);
});

