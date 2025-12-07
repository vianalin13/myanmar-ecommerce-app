/**
 * END-TO-END TEST: FRAUD PREVENTION
 * validates that fraud attempts are properly blocked
 * 
 * test scenarios:
 * 1. prevent delivery without proof of delivery
 * 2. prevent shipping without tracking number
 * 
 * note: concurrent overselling prevention is tested in concurrentTransactions.test.js
 * which has more comprehensive tests (5 buyers, different quantities, double payment prevention)
 */

const request = require("supertest");
const { BASE_URL } = require("../testSetup");
const { setupE2EUsers, cleanupE2EUsers } = require("./sharedSetup");
const { cleanupTestData } = require("../cleanupHelpers");
const { createTestProduct } = require("../products/productHelpers");
const { measureTime } = require("./timingHelpers");
const resultsCollector = require("../resultsCollector");
const { createAuthUserAndGetToken } = require("../auth/authHelpers");

describe("End-to-End: Fraud Prevention Mechanisms", () => {
  let users;
  let productId;
  let productIds = [];
  let orderIds = [];
  let chatIds = [];

  beforeAll(async () => {
    users = await setupE2EUsers();
  }, 30000);

  beforeEach(async () => {
    try {
      productId = await createTestProduct(users.sellerToken, {
        name: `Fraud Test Product ${Date.now()}`,
        price: 10000,
        stock: 10,
        category: "Test",
      });
      productIds.push(productId);
    } catch (error) {
      console.error("Failed to create product in beforeEach:", error.message);
      throw error;
    }
  }, 30000);

  afterEach(async () => {
    //only cleanup test data (products, orders, chats), not users
    //users should persist across tests in the same suite and only be cleaned up in afterAll
    await cleanupTestData({
      productIds,
      orderIds,
      chatIds,
    });
    productIds = [];
    orderIds = [];
    chatIds = [];

    //small delay to ensure Firestore operations complete
    await new Promise(resolve => setTimeout(resolve, 100));
  }, 30000);

  afterAll(async () => {
    await cleanupE2EUsers(users);
  }, 30000);

  test("Prevent delivery without proof of delivery", async () => {
    const flowSteps = [];
    const securityCheckpoints = [];

    //create order and confirm payment
    const orderId = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/createOrder")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({
          sellerId: users.sellerUid,
          products: [{ productId: productId, quantity: 1 }],
          paymentMethod: "KBZPay",
          deliveryAddress: {
            street: "123 Test St",
            city: "Yangon",
            phone: "+959123456789",
          },
        });
      orderIds.push(res.body.orderId);
      securityCheckpoints.push("order_created");
      return res.body.orderId;
    }, "create_order");
    flowSteps.push(orderId);
    resultsCollector.recordApiTiming("createOrder", orderId.duration);
    resultsCollector.recordSecurityCheckpoint("order_created", orderId.result);

    //confirm payment
    const paymentResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/simulatePayment")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({ orderId: orderId.result });
      securityCheckpoints.push("payment_confirmed");
      securityCheckpoints.push("escrow_activated");
      return res;
    }, "confirm_payment");
    flowSteps.push(paymentResult);
    resultsCollector.recordApiTiming("simulatePayment", paymentResult.duration);
    resultsCollector.recordSecurityCheckpoint("payment_confirmed", orderId.result);
    resultsCollector.recordSecurityCheckpoint("escrow_activated", orderId.result);

    //confirm and ship order
    const confirmResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .patch("/updateOrderStatus")
        .set("Authorization", `Bearer ${users.sellerToken}`)
        .send({ orderId: orderId.result, status: "confirmed" });
      return res;
    }, "confirm_order");
    flowSteps.push(confirmResult);
    resultsCollector.recordApiTiming("updateOrderStatus", confirmResult.duration);

    const shipResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .patch("/updateOrderStatus")
        .set("Authorization", `Bearer ${users.sellerToken}`)
        .send({
          orderId: orderId.result,
          status: "shipped",
          trackingNumber: "TRACK001",
        });
      securityCheckpoints.push("tracking_number_required");
      return res;
    }, "ship_order");
    flowSteps.push(shipResult);
    resultsCollector.recordApiTiming("updateOrderStatus", shipResult.duration);
    resultsCollector.recordSecurityCheckpoint("tracking_number_required", orderId.result);

    //attempt to mark delivered without proof (should fail)
    const fraudAttempt = await measureTime(async () => {
      const res = await request(BASE_URL)
        .patch("/updateOrderStatus")
        .set("Authorization", `Bearer ${users.sellerToken}`)
        .send({
          orderId: orderId.result,
          status: "delivered",
          //missing proofOfDelivery - this should be rejected
        });
      return res;
    }, "fraud_attempt_no_proof");
    flowSteps.push(fraudAttempt);
    securityCheckpoints.push("proof_of_delivery_required");

    //verify fraud was blocked
    expect(fraudAttempt.result.statusCode).toBe(400);
    expect(fraudAttempt.result.body.error.toLowerCase()).toContain("proof of delivery");
    
    resultsCollector.recordFraudPrevention(
      "delivery_without_proof",
      true,
      "Proof of delivery required for delivered status"
    );
    resultsCollector.recordApiTiming("updateOrderStatus", fraudAttempt.duration);
    resultsCollector.recordSecurityCheckpoint("proof_of_delivery_required", orderId.result);

    //record complete flow
    const totalDuration = flowSteps.reduce((sum, step) => sum + step.duration, 0);
    const apiCallCount = flowSteps.length;
    resultsCollector.recordFlow({
      scenarioName: "Prevent Delivery Without Proof of Delivery",
      flowType: "fraud_prevention",
      totalDuration,
      steps: flowSteps.map(step => ({
        operation: step.operationName,
        duration: step.duration,
      })),
      apiCallCount,
      securityCheckpointsHit: securityCheckpoints.length,
      success: true, // Flow succeeded in blocking fraud
    });
  }, 30000);

  test("Prevent shipping without tracking number", async () => {
    const flowSteps = [];
    const securityCheckpoints = [];

    const orderId = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/createOrder")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({
          sellerId: users.sellerUid,
          products: [{ productId: productId, quantity: 1 }],
          paymentMethod: "COD",
          deliveryAddress: {
            street: "123 Test St",
            city: "Yangon",
            phone: "+959123456789",
          },
        });
      orderIds.push(res.body.orderId);
      securityCheckpoints.push("order_created");
      return res.body.orderId;
    }, "create_order");
    flowSteps.push(orderId);
    resultsCollector.recordApiTiming("createOrder", orderId.duration);
    resultsCollector.recordSecurityCheckpoint("order_created", orderId.result);

    const confirmResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .patch("/updateOrderStatus")
        .set("Authorization", `Bearer ${users.sellerToken}`)
        .send({ orderId: orderId.result, status: "confirmed" });
      return res;
    }, "confirm_order");
    flowSteps.push(confirmResult);
    resultsCollector.recordApiTiming("updateOrderStatus", confirmResult.duration);

    //attempt to ship without tracking number (should fail)
    const fraudAttempt = await measureTime(async () => {
      const res = await request(BASE_URL)
        .patch("/updateOrderStatus")
        .set("Authorization", `Bearer ${users.sellerToken}`)
        .send({
          orderId: orderId.result,
          status: "shipped",
          //missing trackingNumber - this should be rejected
        });
      return res;
    }, "fraud_attempt_no_tracking");
    flowSteps.push(fraudAttempt);
    securityCheckpoints.push("tracking_number_required");

    expect(fraudAttempt.result.statusCode).toBe(400);
    expect(fraudAttempt.result.body.error.toLowerCase()).toContain("tracking number");
    
    resultsCollector.recordFraudPrevention(
      "shipping_without_tracking",
      true,
      "Tracking number required for shipped status"
    );
    resultsCollector.recordApiTiming("updateOrderStatus", fraudAttempt.duration);
    resultsCollector.recordSecurityCheckpoint("tracking_number_required", orderId.result);

    //record complete flow
    const totalDuration = flowSteps.reduce((sum, step) => sum + step.duration, 0);
    const apiCallCount = flowSteps.length;
    resultsCollector.recordFlow({
      scenarioName: "Prevent Shipping Without Tracking Number",
      flowType: "fraud_prevention",
      totalDuration,
      steps: flowSteps.map(step => ({
        operation: step.operationName,
        duration: step.duration,
      })),
      apiCallCount,
      securityCheckpointsHit: securityCheckpoints.length,
      success: true, // Flow succeeded in blocking fraud
    });
  }, 30000);

  // Note: Concurrent overselling prevention is now tested in concurrentTransactions.test.js
  // which has more comprehensive tests (5 buyers, different quantities, etc.)
});

