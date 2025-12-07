/**
 * SIMULATE PAYMENT TEST SUITE
 * Tests the simulatePayment function with proper isolation and cleanup
 * 
 * Features:
 * - Phone number authentication (Myanmar format)
 * - Test isolation (beforeEach/afterEach)
 * - Complete cleanup to prevent repeated run failures
 * - Tests payment simulation for KBZPay, WavePay, and other methods
 * - Tests escrow release for delivered orders
 */

const request = require("supertest");
const { firestore, BASE_URL } = require("../testSetup");
const { createAuthUserAndGetToken } = require("../auth/authHelpers");
const { cleanupTestData } = require("../cleanupHelpers");
const { createTestProduct } = require("../products/productHelpers");
const { createTestOrder } = require("./orderHelpers");

// ============================================================================
// SIMULATE PAYMENT TESTS
// ============================================================================

describe("Simulate Payment API Tests", () => {
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

  test("Simulate payment (KBZPay - with transactionId and receiptId)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456789",
        receiptId: "RECEIPT123456789",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Payment confirmed successfully");
    expect(res.body.orderId).toBe(orderId);
    expect(res.body.paymentConfirmation).toBeDefined();
    expect(res.body.paymentConfirmation.transactionId).toBe("TXN123456789");
    expect(res.body.paymentConfirmation.receiptId).toBe("RECEIPT123456789");
    expect(res.body.paymentConfirmation.paidAt).toBeDefined();

    // Verify payment status in Firestore
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.paymentStatus).toBe("paid");
    expect(orderData.paymentConfirmation.transactionId).toBe("TXN123456789");
    expect(orderData.paymentConfirmation.receiptId).toBe("RECEIPT123456789");
    expect(orderData.paymentConfirmation.paidAt).toBeDefined();
  }, 30000);

  test("Simulate payment (KBZPay - auto-generated receiptId, transactionId required)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN_AUTO_GEN_TEST",
        // receiptId not provided - should be auto-generated
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.paymentConfirmation).toBeDefined();
    expect(res.body.paymentConfirmation.transactionId).toBe("TXN_AUTO_GEN_TEST");
    expect(res.body.paymentConfirmation.receiptId).toBeDefined();
    expect(res.body.paymentConfirmation.receiptId).toMatch(/^RECEIPT_/);

    // Verify payment status in Firestore
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    expect(orderDoc.data().paymentStatus).toBe("paid");
  }, 30000);

  test("Simulate payment (WavePay)", async () => {
    const orderId = await createTestOrderLocal("WavePay");

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "WAVE_TXN123456",
        receiptId: "WAVE_RECEIPT123456",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify payment status
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    expect(orderDoc.data().paymentStatus).toBe("paid");
    expect(orderDoc.data().paymentMethod).toBe("WavePay");
  }, 30000);


  test("Simulate payment (delivered order - auto-release escrow)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Update order status to delivered
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

    // Now simulate payment (order is already delivered)
    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify payment status and escrow release
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.paymentStatus).toBe("paid");
    expect(orderData.status).toBe("delivered");
    expect(orderData.escrowReleased).toBe(true); // Escrow should be auto-released
    expect(orderData.escrowReleasedAt).toBeDefined();
    expect(orderData.escrowReleasedBy).toBe("system"); // Automated release
  }, 30000);

  test("Simulate payment (payment confirmation details)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const transactionId = "CUSTOM_TXN123456";
    const receiptId = "CUSTOM_RECEIPT123456";

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: transactionId,
        receiptId: receiptId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.paymentConfirmation.transactionId).toBe(transactionId);
    expect(res.body.paymentConfirmation.receiptId).toBe(receiptId);
    expect(res.body.paymentConfirmation.paidAt).toBeDefined();

    // Verify in Firestore
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const paymentConfirmation = orderDoc.data().paymentConfirmation;
    expect(paymentConfirmation.transactionId).toBe(transactionId);
    expect(paymentConfirmation.receiptId).toBe(receiptId);
    expect(paymentConfirmation.paidAt).toBeDefined();
  }, 30000);

  // ========================================================================
  // VALIDATION ERROR CASES
  // ========================================================================

  test("Simulate payment (missing orderId)", async () => {
    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        // Missing orderId
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required field: orderId/);
  }, 30000);

  test("Simulate payment (order not found)", async () => {
    const fakeOrderId = "fakeOrderId123";

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: fakeOrderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Order not found/);
  }, 30000);

  test("Simulate payment (already paid)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Simulate payment first time
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Try to simulate payment again (should fail)
    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN789012",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Order is already paid/);
  }, 30000);

  test("Simulate payment (COD - should fail)", async () => {
    const orderId = await createTestOrderLocal("COD");

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/COD payment is confirmed on delivery/);
    expect(res.body.error).toMatch(/not through this endpoint/);

    // Verify payment status is still pending
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    expect(orderDoc.data().paymentStatus).toBe("pending");
  }, 30000);

  // ========================================================================
  // AUTHORIZATION ERROR CASES
  // ========================================================================

  test("Simulate payment (unauthorized - not buyer)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Seller tries to simulate payment (should fail)
    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized/);
    expect(res.body.error).toMatch(/you can only confirm payment for your own orders/);

    // Verify payment status is still pending
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    expect(orderDoc.data().paymentStatus).toBe("pending");
  }, 30000);

  test("Simulate payment (unauthorized - other buyer)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Create another buyer
    const otherBuyerUid = `TEST_OTHER_BUYER_${Date.now()}`;
    const otherBuyerToken = await createAuthUserAndGetToken(otherBuyerUid, "buyer", "unverified");

    // Other buyer tries to simulate payment (should fail)
    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${otherBuyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized/);

    // Cleanup
    await cleanupTestData({
      buyerUid: otherBuyerUid,
    });
  }, 30000);

  test("Simulate payment (no auth token)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  test("Simulate payment (invalid auth token)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", "Bearer invalidToken123")
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  // ========================================================================
  // HTTP METHOD ERROR CASES
  // ========================================================================

  test("Simulate payment (wrong HTTP method - GET)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const res = await request(BASE_URL)
      .get("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .query({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use POST method/);
  }, 30000);

  test("Simulate payment (wrong HTTP method - PATCH)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const res = await request(BASE_URL)
      .patch("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use POST method/);
  }, 30000);

  // ========================================================================
  // EDGE CASES
  // ========================================================================

  test("Simulate payment (only transactionId provided)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
        // receiptId not provided - should be auto-generated
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.paymentConfirmation.transactionId).toBe("TXN123456");
    expect(res.body.paymentConfirmation.receiptId).toBeDefined(); // Auto-generated
    expect(res.body.paymentConfirmation.receiptId).toMatch(/^RECEIPT_/);
  }, 30000);

  test("Simulate payment (only receiptId provided, transactionId required)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN_REQUIRED_TEST",
        receiptId: "RECEIPT123456",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.paymentConfirmation.receiptId).toBe("RECEIPT123456");
    expect(res.body.paymentConfirmation.transactionId).toBe("TXN_REQUIRED_TEST");
  }, 30000);

  test("Simulate payment (missing transactionId - should fail)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        // transactionId not provided - should fail
        receiptId: "RECEIPT123456",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required field: transactionId/);
  }, 30000);

  // ========================================================================
  // ORDER STATUS VALIDATION TESTS
  // ========================================================================

  test("Simulate payment (cancelled order - should fail)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Cancel the order
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    // Try to confirm payment for cancelled order (should fail)
    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Cannot confirm payment.*cancelled/);
  }, 30000);

  test("Simulate payment (refunded order - should fail)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment first
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN_INITIAL",
      });

    // Cancel the paid order (becomes refunded)
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    // Verify order is refunded
    const orderDocBefore = await firestore.collection("orders").doc(orderId).get();
    expect(orderDocBefore.data().status).toBe("refunded");
    expect(orderDocBefore.data().paymentStatus).toBe("refunded");

    // Try to confirm payment for refunded order (should fail)
    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN_NEW",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Cannot confirm payment.*refunded/);
  }, 30000);

  test("Simulate payment (refunded payment status - should fail)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment first
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN_INITIAL",
      });

    // Cancel the paid order (becomes refunded)
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    // Verify payment status is refunded
    const orderDocBefore = await firestore.collection("orders").doc(orderId).get();
    expect(orderDocBefore.data().paymentStatus).toBe("refunded");

    // Try to confirm payment again (should fail - payment status is refunded)
    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN_NEW",
      });

    expect(res.statusCode).toBe(400);
    // Error message from order status check (status is "refunded")
    expect(res.body.error).toMatch(/Cannot confirm payment.*refunded/);
  }, 30000);

  test("Simulate payment (pending order - no escrow release)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(200);

    // Verify payment status but escrow should NOT be released (order not delivered)
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.paymentStatus).toBe("paid");
    expect(orderData.status).toBe("pending");
    expect(orderData.escrowReleased).toBeFalsy(); // Escrow not released (order not delivered)
  }, 30000);

  test("Simulate payment (confirmed order - no escrow release)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Update order status to confirmed
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // Simulate payment
    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(200);

    // Verify payment status but escrow should NOT be released (order not delivered)
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.paymentStatus).toBe("paid");
    expect(orderData.status).toBe("confirmed");
    expect(orderData.escrowReleased).toBeFalsy(); // Escrow not released (order not delivered)
  }, 30000);

  test("Simulate payment (shipped order - no escrow release)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Update order status to shipped
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

    // Simulate payment
    const res = await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    expect(res.statusCode).toBe(200);

    // Verify payment status but escrow should NOT be released (order not delivered)
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.paymentStatus).toBe("paid");
    expect(orderData.status).toBe("shipped");
    expect(orderData.escrowReleased).toBeFalsy(); // Escrow not released (order not delivered)
  }, 30000);
});

