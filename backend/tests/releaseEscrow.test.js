/**
 * RELEASE ESCROW TEST SUITE
 * Tests the releaseEscrow function with proper isolation and cleanup
 * 
 * Features:
 * - Phone number authentication (Myanmar format)
 * - Test isolation (beforeEach/afterEach)
 * - Complete cleanup to prevent repeated run failures
 * - Tests admin-only manual escrow release
 * - Tests validation for delivered and paid orders
 */

const request = require("supertest");
const { firestore, BASE_URL } = require("./helpers/testSetup");
const admin = require("firebase-admin");
const { createAuthUserAndGetToken } = require("./helpers/authHelpers");
const { cleanupTestData } = require("./helpers/cleanupHelpers");
const { createTestProduct } = require("./helpers/productHelpers");
const { createTestOrder, createDeliveredAndPaidOrder } = require("./helpers/orderHelpers");

// ============================================================================
// RELEASE ESCROW TESTS
// ============================================================================

describe("Release Escrow API Tests", () => {
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
  // HELPER: Create basic order (wrapper to track orderIds)
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
  // HELPER: Create delivered and paid order (wrapper to track orderIds and disable auto-release)
  // ========================================================================
  async function createDeliveredAndPaidOrderLocal(paymentMethod = "KBZPay") {
    // Use shared helper with autoReleaseEscrow disabled for manual release tests
    const orderId = await createDeliveredAndPaidOrder({
      buyerToken,
      sellerToken,
      sellerId: sellerUid,
      products: [{ productId: productId, quantity: 2 }],
      paymentMethod: paymentMethod,
      autoReleaseEscrow: false, // Disable auto-release for manual release tests
    });
    if (orderId) {
      orderIds.push(orderId);
    }
    return orderId;
  }

  // ========================================================================
  // SUCCESS CASES
  // ========================================================================

  test("Release escrow (admin - delivered and paid order)", async () => {
    // Create order with KBZPay (non-COD) using shared helper
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Update to delivered (but ensure escrow is NOT auto-released)
    // We'll manually set escrowReleased to false to simulate a case where auto-release didn't happen
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

    // Manually set order to delivered and paid, but escrow NOT released
    // This simulates an edge case where auto-release failed or was skipped
    await firestore.collection("orders").doc(orderId).update({
      status: "delivered",
      paymentStatus: "paid",
      deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      proofOfDelivery: {
        otpCode: "123456",
        confirmedBy: sellerUid,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      escrowReleased: false, // Explicitly set to false
    });

    // Now manually release escrow as admin
    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Escrow released successfully");
    expect(res.body.orderId).toBe(orderId);
    expect(res.body.amount).toBe(20000); // 2 * 10000
    expect(res.body.sellerId).toBe(sellerUid);

    // Verify escrow release in Firestore
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.escrowReleased).toBe(true);
    expect(orderData.escrowReleasedAt).toBeDefined();
    expect(orderData.escrowReleasedBy).toBe(adminUid); // Manual release by admin
  }, 30000);

  test("Release escrow (admin - COD order delivered and paid)", async () => {
    // Create COD order using shared helper
    const orderId = await createTestOrderLocal("COD");

    // Update to delivered (COD auto-confirms payment and might auto-release escrow)
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

    // Manually set to delivered with payment, but escrow NOT released
    // This simulates an edge case where auto-release didn't happen
    await firestore.collection("orders").doc(orderId).update({
      status: "delivered",
      paymentStatus: "paid",
      deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      proofOfDelivery: {
        otpCode: "123456",
        confirmedBy: sellerUid,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      escrowReleased: false, // Explicitly set to false (edge case)
    });

    // Manually release escrow as admin
    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify escrow release
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    expect(orderDoc.data().escrowReleased).toBe(true);
    expect(orderDoc.data().escrowReleasedBy).toBe(adminUid);
  }, 30000);

  // ========================================================================
  // VALIDATION ERROR CASES
  // ========================================================================

  test("Release escrow (missing orderId)", async () => {
    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        // Missing orderId
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required field: orderId/);
  }, 30000);

  test("Release escrow (order not found)", async () => {
    const fakeOrderId = "fakeOrderId123";

    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: fakeOrderId,
      });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Order not found/);
  }, 30000);

  test("Release escrow (order not delivered)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment but don't deliver
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Try to release escrow (should fail - order not delivered)
    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Order must be delivered before releasing escrow/);
  }, 30000);

  test("Release escrow (order not paid)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Update to delivered but don't confirm payment
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

    // Manually set to delivered but payment still pending
    await firestore.collection("orders").doc(orderId).update({
      status: "delivered",
      paymentStatus: "pending", // Payment not confirmed
      deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      proofOfDelivery: {
        otpCode: "123456",
        confirmedBy: sellerUid,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });

    // Try to release escrow (should fail - payment not confirmed)
    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Order payment must be confirmed before releasing escrow/);
  }, 30000);

  test("Release escrow (escrow already released)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment and deliver (this will auto-release escrow)
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

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
          otpCode: "123456",
        },
      });

    // Verify escrow is already released (auto-release happened)
    const orderDocBefore = await firestore.collection("orders").doc(orderId).get();
    expect(orderDocBefore.data().escrowReleased).toBe(true);

    // Try to manually release escrow again (should fail)
    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Escrow already released for this order/);
  }, 30000);

  // ========================================================================
  // AUTHORIZATION ERROR CASES
  // ========================================================================

  test("Release escrow (unauthorized - buyer)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Buyer tries to release escrow (should fail)
    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized: only admins can manually release escrow/);
  }, 30000);

  test("Release escrow (unauthorized - seller)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Seller tries to release escrow (should fail)
    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized: only admins can manually release escrow/);
  }, 30000);

  test("Release escrow (no auth token)", async () => {
    const orderId = "someOrderId";

    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  test("Release escrow (invalid auth token)", async () => {
    const orderId = "someOrderId";

    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", "Bearer invalidToken123")
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  // ========================================================================
  // HTTP METHOD ERROR CASES
  // ========================================================================

  test("Release escrow (wrong HTTP method - GET)", async () => {
    const orderId = "someOrderId";

    const res = await request(BASE_URL)
      .get("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use POST method/);
  }, 30000);

  test("Release escrow (wrong HTTP method - PATCH)", async () => {
    const orderId = "someOrderId";

    const res = await request(BASE_URL)
      .patch("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use POST method/);
  }, 30000);

  // ========================================================================
  // EDGE CASES
  // ========================================================================

  test("Release escrow (verify escrow release details)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Manually set to delivered and paid, but escrow NOT released
    await firestore.collection("orders").doc(orderId).update({
      status: "delivered",
      paymentStatus: "paid",
      deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      proofOfDelivery: {
        otpCode: "123456",
        confirmedBy: sellerUid,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      escrowReleased: false,
    });

    // Release escrow
    const res = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.amount).toBe(20000);
    expect(res.body.sellerId).toBe(sellerUid);

    // Verify all escrow release fields
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.escrowReleased).toBe(true);
    expect(orderData.escrowReleasedAt).toBeDefined();
    expect(orderData.escrowReleasedBy).toBe(adminUid);
    expect(orderData.updatedAt).toBeDefined();
  }, 30000);

  test("Release escrow (multiple orders - verify isolation)", async () => {
    // Create first order
    const orderRes1 = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId, quantity: 1 }],
        paymentMethod: "KBZPay",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });
    const orderId1 = orderRes1.body.orderId;
    orderIds.push(orderId1);

    // Create second order
    const orderRes2 = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId, quantity: 1 }],
        paymentMethod: "WavePay",
        deliveryAddress: {
          street: "456 Test Ave",
          city: "Yangon",
          phone: "+959987654321",
        },
      });
    const orderId2 = orderRes2.body.orderId;
    orderIds.push(orderId2);

    // Confirm payments
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId1,
        transactionId: "TXN1",
      });

    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId2,
        transactionId: "TXN2",
      });

    // Set both to delivered and paid, but escrow NOT released
    await firestore.collection("orders").doc(orderId1).update({
      status: "delivered",
      paymentStatus: "paid",
      deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      proofOfDelivery: {
        otpCode: "123456",
        confirmedBy: sellerUid,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      escrowReleased: false,
    });

    await firestore.collection("orders").doc(orderId2).update({
      status: "delivered",
      paymentStatus: "paid",
      deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      proofOfDelivery: {
        otpCode: "789012",
        confirmedBy: sellerUid,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      escrowReleased: false,
    });

    // Release escrow for first order
    const res1 = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId1,
      });

    expect(res1.statusCode).toBe(200);
    expect(res1.body.orderId).toBe(orderId1);

    // Release escrow for second order
    const res2 = await request(BASE_URL)
      .post("/releaseEscrow")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId2,
      });

    expect(res2.statusCode).toBe(200);
    expect(res2.body.orderId).toBe(orderId2);

    // Verify both orders have escrow released independently
    const orderDoc1 = await firestore.collection("orders").doc(orderId1).get();
    const orderDoc2 = await firestore.collection("orders").doc(orderId2).get();
    expect(orderDoc1.data().escrowReleased).toBe(true);
    expect(orderDoc2.data().escrowReleased).toBe(true);
    expect(orderDoc1.data().escrowReleasedBy).toBe(adminUid);
    expect(orderDoc2.data().escrowReleasedBy).toBe(adminUid);
  }, 30000);
});

