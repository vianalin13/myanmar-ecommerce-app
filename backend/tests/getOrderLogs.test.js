/**
 * GET ORDER LOGS TEST SUITE
 * Tests the getOrderLogs function with proper isolation and cleanup
 * 
 * Features:
 * - Phone number authentication (Myanmar format)
 * - Test isolation (beforeEach/afterEach)
 * - Complete cleanup to prevent repeated run failures
 * - Tests admin-only access to audit logs
 * - Tests complete audit trail retrieval
 */

const request = require("supertest");
const { firestore, BASE_URL } = require("./helpers/testSetup");
const { createAuthUserAndGetToken } = require("./helpers/authHelpers");
const { cleanupTestData } = require("./helpers/cleanupHelpers");
const { createTestProduct } = require("./helpers/productHelpers");
const { createTestOrder, createOrderWithStatus } = require("./helpers/orderHelpers");

// ============================================================================
// GET ORDER LOGS TESTS
// ============================================================================

describe("Get Order Logs API Tests", () => {
  let buyerUid;
  let sellerUid;
  let adminUid;
  let buyerToken;
  let sellerToken;
  let adminToken;
  let productId;
  let productIds = [];
  let orderIds = [];

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
    });
    orderIds = [];
    productIds = [];
  }, 30000); // Increase timeout for cleanup

  // ========================================================================
  // HELPER: Create order for testing (wrapper to track orderIds)
  // ========================================================================
  async function createTestOrderLocal(paymentMethod = "KBZPay") {
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
  // SUCCESS CASES
  // ========================================================================

  test("Get order logs (admin - order with logs)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Create some activity to generate logs
    // 1. Order created (already done)
    // 2. Confirm payment
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // 3. Update status to confirmed
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // 4. Update status to shipped
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "shipped",
        trackingNumber: "TRACK123456789",
      });

    // Wait a bit for logs to be written
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get logs as admin
    const res = await request(BASE_URL)
      .get("/getOrderLogs")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBe(orderId);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.logs).toBeDefined();
    expect(Array.isArray(res.body.logs)).toBe(true);

    // Verify log structure
    if (res.body.logs.length > 0) {
      const firstLog = res.body.logs[0];
      expect(firstLog).toHaveProperty("logId");
      expect(firstLog).toHaveProperty("eventType");
      expect(firstLog).toHaveProperty("actorId");
      expect(firstLog).toHaveProperty("timestamp");
      expect(firstLog).toHaveProperty("metadata");
    }

    // Verify expected event types are present
    const eventTypes = res.body.logs.map(log => log.eventType);
    expect(eventTypes).toContain("order_created");
    expect(eventTypes).toContain("payment_confirmed");
    expect(eventTypes).toContain("status_updated");
    expect(eventTypes).toContain("tracking_number_added");

    // Verify logs are sorted chronologically (oldest first)
    if (res.body.logs.length > 1) {
      for (let i = 1; i < res.body.logs.length; i++) {
        const prevTimestamp = res.body.logs[i - 1].timestamp;
        const currTimestamp = res.body.logs[i].timestamp;
        
        // Convert Firestore Timestamp to milliseconds for comparison
        // Handle different timestamp formats (Firestore Timestamp object or serialized)
        let prevTime, currTime;
        
        if (prevTimestamp && typeof prevTimestamp === 'object') {
          // Firestore Timestamp object (has toMillis method)
          if (prevTimestamp.toMillis) {
            prevTime = prevTimestamp.toMillis();
          } else if (prevTimestamp._seconds) {
            // Serialized Firestore Timestamp
            prevTime = prevTimestamp._seconds * 1000 + (prevTimestamp._nanoseconds || 0) / 1000000;
          } else if (prevTimestamp.seconds) {
            // Alternative serialized format
            prevTime = prevTimestamp.seconds * 1000 + (prevTimestamp.nanoseconds || 0) / 1000000;
          } else {
            prevTime = new Date(prevTimestamp).getTime();
          }
        } else {
          prevTime = new Date(prevTimestamp).getTime();
        }
        
        if (currTimestamp && typeof currTimestamp === 'object') {
          // Firestore Timestamp object (has toMillis method)
          if (currTimestamp.toMillis) {
            currTime = currTimestamp.toMillis();
          } else if (currTimestamp._seconds) {
            // Serialized Firestore Timestamp
            currTime = currTimestamp._seconds * 1000 + (currTimestamp._nanoseconds || 0) / 1000000;
          } else if (currTimestamp.seconds) {
            // Alternative serialized format
            currTime = currTimestamp.seconds * 1000 + (currTimestamp.nanoseconds || 0) / 1000000;
          } else {
            currTime = new Date(currTimestamp).getTime();
          }
        } else {
          currTime = new Date(currTimestamp).getTime();
        }
        
        // Only compare if both timestamps are valid
        if (!isNaN(prevTime) && !isNaN(currTime)) {
          expect(currTime).toBeGreaterThanOrEqual(prevTime);
        }
      }
    }
  }, 30000);

  test("Get order logs (admin - complete order flow)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Complete order flow to generate all log types
    // 1. Order created (already done)
    
    // 2. Confirm payment
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN_COMPLETE_FLOW",
      });

    // 3. Confirm order
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // 4. Ship order
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "shipped",
        trackingNumber: "TRACK_COMPLETE",
      });

    // 5. Deliver order (with proof)
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: {
          otpCode: "123456",
        },
      });

    // Wait for all logs to be written
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get logs as admin
    const res = await request(BASE_URL)
      .get("/getOrderLogs")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(5); // At least 5 events

    // Verify all expected event types
    const eventTypes = res.body.logs.map(log => log.eventType);
    expect(eventTypes).toContain("order_created");
    expect(eventTypes).toContain("payment_confirmed");
    expect(eventTypes).toContain("status_updated");
    expect(eventTypes).toContain("tracking_number_added");
    expect(eventTypes).toContain("delivery_proof_submitted");
    
    // Escrow should be auto-released on delivery
    expect(eventTypes).toContain("escrow_released");
  }, 30000);

  test("Get order logs (admin - order with no logs)", async () => {
    // Create an order but don't perform any actions that generate logs
    // Note: order_created log should still exist, but let's test edge case
    const orderId = await createTestOrderLocal("KBZPay");

    // Wait a bit for order_created log
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get logs as admin
    const res = await request(BASE_URL)
      .get("/getOrderLogs")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBe(orderId);
    expect(res.body.count).toBeGreaterThanOrEqual(1); // At least order_created
    expect(res.body.logs).toBeDefined();
    expect(Array.isArray(res.body.logs)).toBe(true);
  }, 30000);

  test("Get order logs (admin - refunded order)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN_REFUND_TEST",
      });

    // Cancel order (should become refunded since payment was paid)
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    // Wait for logs
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get logs as admin
    const res = await request(BASE_URL)
      .get("/getOrderLogs")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify refund log exists
    const eventTypes = res.body.logs.map(log => log.eventType);
    expect(eventTypes).toContain("order_refunded");
    expect(eventTypes).toContain("payment_confirmed");
  }, 30000);

  // ========================================================================
  // VALIDATION TESTS
  // ========================================================================

  test("Get order logs (missing orderId - should fail)", async () => {
    const res = await request(BASE_URL)
      .get("/getOrderLogs")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        // orderId missing
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required parameter.*orderId/i);
  }, 30000);

  test("Get order logs (order not found - should fail)", async () => {
    const res = await request(BASE_URL)
      .get("/getOrderLogs")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        orderId: "NON_EXISTENT_ORDER_ID",
      });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Order not found/i);
  }, 30000);

  // ========================================================================
  // AUTHORIZATION TESTS
  // ========================================================================

  test("Get order logs (buyer - should fail)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .get("/getOrderLogs")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized.*only admins/i);
  }, 30000);

  test("Get order logs (seller - should fail)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .get("/getOrderLogs")
      .set("Authorization", `Bearer ${sellerToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized.*only admins/i);
  }, 30000);

  test("Get order logs (no auth - should fail)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .get("/getOrderLogs")
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(401);
  }, 30000);

  // ========================================================================
  // HTTP METHOD TESTS
  // ========================================================================

  test("Get order logs (POST method - should fail)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .post("/getOrderLogs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use GET method/i);
  }, 30000);

  // ========================================================================
  // LOG METADATA VERIFICATION
  // ========================================================================

  test("Get order logs (verify log metadata structure)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment to generate payment log
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN_METADATA_TEST",
      });

    // Wait for logs
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get logs
    const res = await request(BASE_URL)
      .get("/getOrderLogs")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);

    // Find payment_confirmed log
    const paymentLog = res.body.logs.find(log => log.eventType === "payment_confirmed");
    expect(paymentLog).toBeDefined();
    expect(paymentLog.metadata).toBeDefined();
    expect(paymentLog.metadata.paymentMethod).toBe("KBZPay");
    expect(paymentLog.metadata.transactionId).toBe("TXN_METADATA_TEST");
    expect(paymentLog.actorId).toBe(buyerUid);
  }, 30000);
});

