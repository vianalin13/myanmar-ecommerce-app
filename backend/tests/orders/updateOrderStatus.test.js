/**
 * UPDATE ORDER STATUS TEST SUITE
 * Tests the updateOrderStatus function with proper isolation and cleanup
 * 
 * Features:
 * - Phone number authentication (Myanmar format)
 * - Test isolation (beforeEach/afterEach)
 * - Complete cleanup to prevent repeated run failures
 * - Tests all status transitions, tracking numbers, proof of delivery, stock restoration, escrow release
 */

const request = require("supertest");
const { firestore, BASE_URL } = require("../testSetup");
const { createAuthUserAndGetToken } = require("../auth/authHelpers");
const { cleanupTestData } = require("../cleanupHelpers");
const { createTestProduct } = require("../products/productHelpers");
const { createTestOrder } = require("./orderHelpers");

// ============================================================================
// UPDATE ORDER STATUS TESTS
// ============================================================================

describe("Update Order Status API Tests", () => {
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
  // SUCCESS CASES: STATUS TRANSITIONS
  // ========================================================================

  test("Update order status (pending → confirmed)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("confirmed");

    // Verify order status in Firestore
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    expect(orderDoc.data().status).toBe("confirmed");
    expect(orderDoc.data().updatedAt).toBeDefined();
  }, 30000);

  test("Update order status (confirmed → shipped - with tracking number)", async () => {
    const orderId = await createTestOrderLocal();

    // First confirm
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // Then ship with tracking number
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "shipped",
        trackingNumber: "TRACK123456789",
        trackingProvider: "myanmar_post",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("shipped");

    // Verify tracking info in Firestore
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.status).toBe("shipped");
    expect(orderData.trackingNumber).toBe("TRACK123456789");
    expect(orderData.trackingProvider).toBe("myanmar_post");
    expect(orderData.shippedAt).toBeDefined();
  }, 30000);

  test("Update order status (shipped → delivered - with proof of delivery)", async () => {
    const orderId = await createTestOrderLocal();

    // Status progression: pending → confirmed → shipped → delivered
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

    // Mark as delivered with proof
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: {
          photoURL: "https://example.com/delivery-photo.jpg",
          otpCode: "123456",
          deliveryNotes: "Delivered to recipient",
        },
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("delivered");

    // Verify delivery info in Firestore
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.status).toBe("delivered");
    expect(orderData.deliveredAt).toBeDefined();
    expect(orderData.proofOfDelivery).toBeDefined();
    expect(orderData.proofOfDelivery.photoURL).toBe("https://example.com/delivery-photo.jpg");
    expect(orderData.proofOfDelivery.otpCode).toBe("123456");
    expect(orderData.proofOfDelivery.deliveryNotes).toBe("Delivered to recipient");
    expect(orderData.proofOfDelivery.confirmedBy).toBe(sellerUid);
  }, 30000);

  test("Update order status (delivered - COD auto-payment and escrow release)", async () => {
    const orderId = await createTestOrderLocal("COD"); // COD order

    // Status progression
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

    // Mark as delivered (COD should auto-pay and release escrow)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: {
          otpCode: "123456",
        },
      });

    expect(res.statusCode).toBe(200);

    // Verify COD payment is auto-confirmed and escrow is released
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.paymentStatus).toBe("paid"); // COD auto-paid on delivery
    expect(orderData.escrowReleased).toBe(true); // Escrow auto-released
    expect(orderData.escrowReleasedAt).toBeDefined();
    expect(orderData.escrowReleasedBy).toBe("system"); // Automated release
  }, 30000);

  test("Update order status (delivered - KBZPay with pre-confirmed payment)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment first
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Status progression
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

    // Mark as delivered (payment already confirmed, escrow should auto-release)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: {
          photoURL: "https://example.com/delivery.jpg",
        },
      });

    expect(res.statusCode).toBe(200);

    // Verify escrow is released (payment was already confirmed)
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.paymentStatus).toBe("paid");
    expect(orderData.escrowReleased).toBe(true); // Escrow auto-released after delivery
  }, 30000);

  // ========================================================================
  // BUYER CANCELLATION TESTS
  // ========================================================================

  test("Buyer cancel order (pending status - unpaid order)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("cancelled"); // Unpaid order stays "cancelled"

    // Verify order is cancelled (unpaid order)
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.status).toBe("cancelled");
    expect(orderData.paymentStatus).toBe("pending"); // Payment status stays pending
    expect(orderData.cancelledAt).toBeDefined();
    expect(orderData.refundedAt).toBeUndefined(); // Not refunded (unpaid)

    // Verify stock is restored
    const productDoc = await firestore.collection("products").doc(productId).get();
    expect(productDoc.data().stock).toBe(100); // Original stock restored (100 - 2 + 2 = 100)
  }, 30000);

  test("Buyer cancel order (confirmed status - unpaid order)", async () => {
    const orderId = await createTestOrderLocal();

    // First confirm
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // Buyer cancels
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("cancelled"); // Unpaid order stays "cancelled"

    // Verify order is cancelled (unpaid order)
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.status).toBe("cancelled");
    expect(orderData.paymentStatus).toBe("pending"); // Payment status stays pending
    expect(orderData.cancelledAt).toBeDefined();
    expect(orderData.refundedAt).toBeUndefined(); // Not refunded (unpaid)

    // Verify stock is restored
    const productDoc = await firestore.collection("products").doc(productId).get();
    expect(productDoc.data().stock).toBe(100); // Stock restored
  }, 30000);

  test("Buyer cancel order (shipped status - should fail)", async () => {
    const orderId = await createTestOrderLocal();

    // Status progression to shipped
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

    // Buyer tries to cancel (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Cannot cancel order/);
    expect(res.body.error).toMatch(/pending.*confirmed|confirmed.*pending/);

    // Verify order is still shipped (not cancelled)
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    expect(orderDoc.data().status).toBe("shipped");
  }, 30000);

  test("Buyer cancel order (delivered status - should fail)", async () => {
    const orderId = await createTestOrderLocal();

    // Status progression to delivered
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

    // Buyer tries to cancel (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Cannot cancel order/);
  }, 30000);

  test("Buyer update status (not cancelled - should fail)", async () => {
    const orderId = await createTestOrderLocal();

    // Buyer tries to update to confirmed (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed", // Buyers can only cancel
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/buyers can only cancel orders/);
  }, 30000);

  test("Buyer cancel order (already cancelled - should fail)", async () => {
    const orderId = await createTestOrderLocal();

    // Cancel once
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    // Try to cancel again (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/already cancelled or refunded/);
  }, 30000);

  test("Buyer cancel order (already refunded - should fail)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment first
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Cancel paid order (becomes refunded)
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    // Try to cancel again (should fail - order is now refunded)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/already cancelled or refunded/);
  }, 30000);

  // ========================================================================
  // SELLER CANCELLATION TESTS
  // ========================================================================

  test("Seller cancel order (pending status - unpaid order)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("cancelled"); // Unpaid order stays "cancelled"

    // Verify order is cancelled (unpaid order)
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.status).toBe("cancelled");
    expect(orderData.paymentStatus).toBe("pending"); // Payment status stays pending
    expect(orderData.cancelledAt).toBeDefined();
    expect(orderData.refundedAt).toBeUndefined(); // Not refunded (unpaid)

    // Verify stock is restored
    const productDoc = await firestore.collection("products").doc(productId).get();
    expect(productDoc.data().stock).toBe(100); // Stock restored
  }, 30000);

  // ========================================================================
  // REFUND TESTS (Cancelling Paid Orders)
  // ========================================================================

  test("Cancel paid order (should automatically become refunded)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment first
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Verify payment is confirmed
    const orderDocBefore = await firestore.collection("orders").doc(orderId).get();
    expect(orderDocBefore.data().paymentStatus).toBe("paid");

    // Cancel the paid order (should automatically become refunded)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("refunded"); // Paid order becomes "refunded"

    // Verify order is refunded
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.status).toBe("refunded");
    expect(orderData.paymentStatus).toBe("refunded");
    expect(orderData.refundedAt).toBeDefined();
    expect(orderData.refundedBy).toBe(buyerUid);
    expect(orderData.cancelledAt).toBeDefined(); // Also has cancelledAt timestamp

    // Verify stock is restored
    const productDoc = await firestore.collection("products").doc(productId).get();
    expect(productDoc.data().stock).toBe(100); // Stock restored
  }, 30000);

  test("Seller cancel paid order (should automatically become refunded)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment first
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Seller cancels the paid order (should automatically become refunded)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("refunded"); // Paid order becomes "refunded"

    // Verify order is refunded
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.status).toBe("refunded");
    expect(orderData.paymentStatus).toBe("refunded");
    expect(orderData.refundedAt).toBeDefined();
    expect(orderData.refundedBy).toBe(sellerUid);
    expect(orderData.cancelledAt).toBeDefined(); // Also has cancelledAt timestamp

    // Verify stock is restored
    const productDoc = await firestore.collection("products").doc(productId).get();
    expect(productDoc.data().stock).toBe(100); // Stock restored
  }, 30000);

  test("Cancel paid order (confirmed status - should become refunded)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment first
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Confirm order status
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // Cancel the paid confirmed order (should automatically become refunded)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("refunded"); // Paid order becomes "refunded"

    // Verify order is refunded
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.status).toBe("refunded");
    expect(orderData.paymentStatus).toBe("refunded");
    expect(orderData.refundedAt).toBeDefined();

    // Verify stock is restored
    const productDoc = await firestore.collection("products").doc(productId).get();
    expect(productDoc.data().stock).toBe(100); // Stock restored
  }, 30000);

  test("Cannot set refunded status directly (should fail)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

    // Confirm payment first
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });

    // Try to set refunded status directly (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "refunded",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Cannot set refunded status directly/);
    expect(res.body.error).toMatch(/automatically set when cancelling/);

    // Verify order is still paid (not refunded)
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.status).toBe("pending"); // Still pending (not cancelled/refunded)
    expect(orderData.paymentStatus).toBe("paid"); // Payment is still paid
  }, 30000);

  test("Cannot set refunded status directly on unpaid order (should fail)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");
    // Order is created with paymentStatus: "pending"

    // Try to set refunded status directly on unpaid order (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "refunded",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Cannot set refunded status directly/);
    expect(res.body.error).toMatch(/automatically set when cancelling/);

    // Verify order is still pending (not refunded)
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.status).toBe("pending");
    expect(orderData.paymentStatus).toBe("pending");
  }, 30000);

  // ========================================================================
  // TRACKING NUMBER TESTS
  // ========================================================================

  test("Update order status (shipped - tracking number required)", async () => {
    const orderId = await createTestOrderLocal();

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // Try to ship without tracking number (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "shipped",
        // Missing trackingNumber
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Tracking number is required/);
  }, 30000);

  test("Update order status (shipped - empty tracking number - should fail)", async () => {
    const orderId = await createTestOrderLocal();

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // Try to ship with empty tracking number (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "shipped",
        trackingNumber: "   ", // Empty string
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid tracking number/);
  }, 30000);

  test("Update order status (shipped - tracking number with default provider)", async () => {
    const orderId = await createTestOrderLocal();

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // Ship with tracking number but no provider (should default to "local_courier")
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "shipped",
        trackingNumber: "TRACK123456789",
        // No trackingProvider - should default to "local_courier"
      });

    expect(res.statusCode).toBe(200);

    // Verify default provider
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    expect(orderDoc.data().trackingProvider).toBe("local_courier");
  }, 30000);

  // ========================================================================
  // PROOF OF DELIVERY TESTS
  // ========================================================================

  test("Update order status (delivered - proof of delivery required)", async () => {
    const orderId = await createTestOrderLocal();

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

    // Try to deliver without proof (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        // Missing proofOfDelivery
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Proof of delivery is required/);
  }, 30000);

  test("Update order status (delivered - invalid proof of delivery - should fail)", async () => {
    const orderId = await createTestOrderLocal();

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

    // Try to deliver with empty proof object (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: {}, // Empty object
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid proof of delivery/);
  }, 30000);

  test("Update order status (delivered - COD with weak proof - should fail)", async () => {
    const orderId = await createTestOrderLocal("COD");

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

    // Try to deliver COD order with only deliveryNotes (weak proof - should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: {
          deliveryNotes: "Delivered", // Only notes, no OTP/photo/signature
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/COD orders require stronger proof/);
  }, 30000);

  test("Update order status (delivered - COD with OTP proof - should succeed)", async () => {
    const orderId = await createTestOrderLocal("COD");

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

    // Deliver COD order with OTP (strong proof - should succeed)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: {
          otpCode: "123456", // Strong proof for COD
        },
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  }, 30000);

  test("Update order status (delivered - KBZPay with delivery notes - should succeed)", async () => {
    const orderId = await createTestOrderLocal("KBZPay");

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

    // Deliver KBZPay order with only delivery notes (non-COD, weaker proof is OK)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: {
          deliveryNotes: "Delivered to recipient", // Non-COD, notes are OK
        },
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  }, 30000);

  test("Update order status (delivered - with all proof types)", async () => {
    const orderId = await createTestOrderLocal();

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

    // Deliver with all proof types
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: {
          photoURL: "https://example.com/photo.jpg",
          otpCode: "123456",
          signatureURL: "https://example.com/signature.jpg",
          deliveryNotes: "Delivered successfully",
        },
      });

    expect(res.statusCode).toBe(200);

    // Verify all proof types are stored
    const orderDoc = await firestore.collection("orders").doc(orderId).get();
    const proof = orderDoc.data().proofOfDelivery;
    expect(proof.photoURL).toBe("https://example.com/photo.jpg");
    expect(proof.otpCode).toBe("123456");
    expect(proof.signatureURL).toBe("https://example.com/signature.jpg");
    expect(proof.deliveryNotes).toBe("Delivered successfully");
  }, 30000);

  // ========================================================================
  // ADMIN TESTS
  // ========================================================================

  test("Admin update order status (any order)", async () => {
    const orderId = await createTestOrderLocal();

    // Admin can update any order
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  }, 30000);

  // ========================================================================
  // AUTHORIZATION TESTS
  // ========================================================================

  test("Update order status (unauthorized - other seller)", async () => {
    const orderId = await createTestOrderLocal();

    // Create another seller
    const otherSellerUid = `TEST_OTHER_SELLER_${Date.now()}`;
    const otherSellerToken = await createAuthUserAndGetToken(otherSellerUid, "seller", "verified");

    // Other seller tries to update (should fail)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${otherSellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized/);

    // Cleanup
    await cleanupTestData({
      sellerUid: otherSellerUid,
    });
  }, 30000);

  test("Update order status (unauthorized - other buyer)", async () => {
    const orderId = await createTestOrderLocal();

    // Create another buyer
    const otherBuyerUid = `TEST_OTHER_BUYER_${Date.now()}`;
    const otherBuyerToken = await createAuthUserAndGetToken(otherBuyerUid, "buyer", "unverified");

    // Other buyer tries to cancel (should fail - not their order)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${otherBuyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Unauthorized/);

    // Cleanup
    await cleanupTestData({
      buyerUid: otherBuyerUid,
    });
  }, 30000);

  test("Update order status (no auth token)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error
    expect(res.body.error).toBeDefined();
  }, 30000);

  // ========================================================================
  // VALIDATION ERROR TESTS
  // ========================================================================

  test("Update order status (missing orderId)", async () => {
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        status: "confirmed",
        // Missing orderId
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  }, 30000);

  test("Update order status (missing status)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        // Missing status
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  }, 30000);

  test("Update order status (invalid status)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "invalid_status",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid order status/);
  }, 30000);

  test("Update order status (order not found)", async () => {
    const fakeOrderId = "fakeOrderId123";

    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: fakeOrderId,
        status: "confirmed",
      });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Order not found/);
  }, 30000);

  // ========================================================================
  // HTTP METHOD TESTS
  // ========================================================================

  test("Update order status (wrong HTTP method - GET)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .get("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .query({
        orderId: orderId,
        status: "confirmed",
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use PATCH or POST method/);
  }, 30000);

  test("Update order status (POST method - should work)", async () => {
    const orderId = await createTestOrderLocal();

    // POST should work (as per function implementation)
    const res = await request(BASE_URL)
      .post("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  }, 30000);

  // ========================================================================
  // STOCK RESTORATION TESTS
  // ========================================================================

  test("Update order status (cancel - stock restoration with multiple products)", async () => {
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
          { productId: productId, quantity: 3 },
          { productId: productId2, quantity: 2 },
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

    // Cancel order
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    expect(res.statusCode).toBe(200);

    // Verify stock is restored for both products
    const productDoc1 = await firestore.collection("products").doc(productId).get();
    const productDoc2 = await firestore.collection("products").doc(productId2).get();
    expect(productDoc1.data().stock).toBe(100); // 100 - 3 + 3 = 100
    expect(productDoc2.data().stock).toBe(50); // 50 - 2 + 2 = 50
  }, 30000);

  test("Update order status (cancel - product deleted - should fail gracefully)", async () => {
    const orderId = await createTestOrderLocal();

    // Delete the product (soft delete)
    await request(BASE_URL)
      .delete("/deleteProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        productId: productId,
      });

    // Try to cancel order (should fail because product doesn't exist for stock restoration)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });

    // Note: This should actually work because soft delete doesn't remove the product,
    // it just sets status to "inactive". The product document still exists.
    // So stock restoration should succeed.
    // However, if we hard-deleted the product, this would fail.
    // For now, we'll test that the cancellation works even with inactive product
    expect(res.statusCode).toBe(200); // Should work because product document still exists
  }, 30000);

  // ========================================================================
  // EDGE CASES
  // ========================================================================

  test("Update order status (notes field - optional)", async () => {
    const orderId = await createTestOrderLocal();

    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
        notes: "Order confirmed by seller",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Notes are logged but not stored in order document (only in order logs)
    // This is expected behavior
  }, 30000);

  test("Update order status (status transition - confirmed to confirmed)", async () => {
    const orderId = await createTestOrderLocal();

    // Confirm once
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // Confirm again (should work - idempotent)
    const res = await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  }, 30000);
});

