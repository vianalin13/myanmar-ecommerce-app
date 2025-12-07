/**
 * END-TO-END TEST: FRAUD PREVENTION
 * validates that fraud attempts are properly blocked
 * 
 * test scenarios:
 * 1. prevent delivery without proof of delivery
 * 2. prevent shipping without tracking number
 * 3. prevent overselling with concurrent orders (atomic transactions)
 */

const request = require("supertest");
const { BASE_URL } = require("../helpers/testSetup");
const { setupE2EUsers, cleanupE2EUsers } = require("./sharedSetup");
const { cleanupTestData } = require("../helpers/cleanupHelpers");
const { createTestProduct } = require("../helpers/productHelpers");
const { measureTime } = require("../helpers/timingHelpers");
const resultsCollector = require("../helpers/resultsCollector");
const { createAuthUserAndGetToken } = require("../helpers/authHelpers");

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

  test("Prevent overselling with concurrent orders (atomic transactions)", async () => {
    const flowSteps = [];
    const securityCheckpoints = [];

    //create product with limited stock
    const limitedProductId = await createTestProduct(users.sellerToken, {
      name: "Limited Stock Product",
      price: 10000,
      stock: 1, //only 1 item in stock
      category: "Test",
    });
    productIds.push(limitedProductId);

    //create two buyers
    const buyer2Uid = `E2E_BUYER2_${Date.now()}`;
    const buyer2Token = await createAuthUserAndGetToken(buyer2Uid, "buyer", "unverified");

    //attempt concurrent orders for the same product (should only allow one)
    const concurrentOrders = await Promise.allSettled([
      measureTime(async () => {
        const res = await request(BASE_URL)
          .post("/createOrder")
          .set("Authorization", `Bearer ${users.buyerToken}`)
          .send({
            sellerId: users.sellerUid,
            products: [{ productId: limitedProductId, quantity: 1 }],
            paymentMethod: "COD",
            deliveryAddress: {
              street: "123 Test St",
              city: "Yangon",
              phone: "+959123456789",
            },
          });
        if (res.statusCode === 200) {
          orderIds.push(res.body.orderId);
          securityCheckpoints.push("order_created");
        }
        return res;
      }, "concurrent_order_1"),
      measureTime(async () => {
        const res = await request(BASE_URL)
          .post("/createOrder")
          .set("Authorization", `Bearer ${buyer2Token}`)
          .send({
            sellerId: users.sellerUid,
            products: [{ productId: limitedProductId, quantity: 1 }],
            paymentMethod: "COD",
            deliveryAddress: {
              street: "456 Test St",
              city: "Yangon",
              phone: "+959987654321",
            },
          });
        if (res.statusCode === 200) {
          orderIds.push(res.body.orderId);
          securityCheckpoints.push("order_created");
        }
        return res;
      }, "concurrent_order_2"),
    ]);

    //one should succeed, one should fail (stock insufficient)
    const results = concurrentOrders.map(p => 
      p.status === "fulfilled" ? p.value.result : null
    ).filter(Boolean);

    const successCount = results.filter(r => r.statusCode === 200).length;
    const failureCount = results.filter(r => r.statusCode !== 200).length;

    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    //add both concurrent order attempts to flow steps
    concurrentOrders.forEach((order, index) => {
      if (order.status === "fulfilled") {
        flowSteps.push(order.value);
        resultsCollector.recordApiTiming("createOrder", order.value.duration);
        if (order.value.result.statusCode === 200) {
          resultsCollector.recordSecurityCheckpoint("order_created", order.value.result.body.orderId);
        }
      }
    });

    securityCheckpoints.push("atomic_transaction_validation");
    resultsCollector.recordSecurityCheckpoint("atomic_transaction_validation", limitedProductId);

    resultsCollector.recordFraudPrevention(
      "concurrent_overselling",
      true,
      "Atomic transactions prevent overselling"
    );
    resultsCollector.recordConcurrentTest({
      userCount: 2,
      successCount: 1,
      failureCount: 1,
      averageDuration: (concurrentOrders[0].value.duration + concurrentOrders[1].value.duration) / 2,
      testType: "concurrent_order_creation",
    });

    //record complete flow
    const totalDuration = flowSteps.reduce((sum, step) => sum + step.duration, 0);
    const apiCallCount = flowSteps.length;
    resultsCollector.recordFlow({
      scenarioName: "Prevent Overselling with Concurrent Orders",
      flowType: "fraud_prevention",
      totalDuration,
      steps: flowSteps.map(step => ({
        operation: step.operationName,
        duration: step.duration,
      })),
      apiCallCount,
      securityCheckpointsHit: securityCheckpoints.length,
      success: true, // Flow succeeded in preventing overselling
    });

    //cleanup buyer2
    await cleanupTestData({ buyerUid: buyer2Uid });
  }, 30000);
});

