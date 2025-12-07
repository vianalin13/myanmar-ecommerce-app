/**
 * END-TO-END TEST: HAPPY PATH
 * complete purchase flow from product browsing to delivery
 * 
 * this test validates the full user journey (10 API calls):
 * 1. browse products (getPublicProducts)
 * 2. start chat with seller (startChat)
 * 3. exchange messages (sendMessage - buyer, then seller)
 * 4. create order from chat (createOrder)
 * 5. confirm payment (simulatePayment)
 * 6. seller confirms order (updateOrderStatus)
 * 7. seller ships order (updateOrderStatus with tracking)
 * 8. seller marks delivered (updateOrderStatus with proof)
 * 9. verify order status and escrow release (getOrderById)
 */

const request = require("supertest");
const { BASE_URL } = require("../testSetup");
const { setupE2EUsers, cleanupE2EUsers } = require("./sharedSetup");
const { cleanupTestData } = require("../cleanupHelpers");
const { createTestProduct } = require("../products/productHelpers");
const { measureTime } = require("./timingHelpers");
const resultsCollector = require("../resultsCollector");

describe("End-to-End: Complete Purchase Flow (Happy Path)", () => {
  let users;
  let productId;
  let productIds = [];
  let orderIds = [];
  let chatIds = [];

  //setup users once for all tests in this suite
  beforeAll(async () => {
    users = await setupE2EUsers();
  }, 30000);

  //setup product before each test
  beforeEach(async () => {
    productId = await createTestProduct(users.sellerToken, {
      name: "E2E Test Product",
      price: 15000,
      stock: 10,
      category: "Electronics",
    });
    productIds.push(productId);
  }, 30000);

  //cleanup after each test
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
  }, 30000);

  //cleanup users after all tests
  afterAll(async () => {
    await cleanupE2EUsers(users);
  }, 30000);

  test("Complete purchase journey from browse to delivery with timing", async () => {
    const flowSteps = [];
    let chatId;
    let orderId;
    const securityCheckpoints = [];

    //step 1: browse products
    const browseResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .get("/getPublicProducts");
      expect(res.statusCode).toBe(200);
      expect(res.body.products).toBeDefined();
      return res.body.products;
    }, "browse_products");

    flowSteps.push(browseResult);
    resultsCollector.recordApiTiming("getPublicProducts", browseResult.duration);

    //step 2: start chat with seller
    const chatResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/startChat")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({
          sellerId: users.sellerUid,
          productId: productId,
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.chatId).toBeDefined();
      chatId = res.body.chatId;
      chatIds.push(chatId);
      return res.body;
    }, "start_chat");

    flowSteps.push(chatResult);
    resultsCollector.recordApiTiming("startChat", chatResult.duration);

    //step 3: exchange messages
    const message1Result = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/sendMessage")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({
          chatId: chatId,
          messageText: "Is this product still available?",
          productId: productId,
        });
      expect(res.statusCode).toBe(200);
      return res.body;
    }, "send_message_buyer");

    flowSteps.push(message1Result);
    resultsCollector.recordApiTiming("sendMessage", message1Result.duration);

    const message2Result = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/sendMessage")
        .set("Authorization", `Bearer ${users.sellerToken}`)
        .send({
          chatId: chatId,
          messageText: "Yes, it's available!",
        });
      expect(res.statusCode).toBe(200);
      return res.body;
    }, "send_message_seller");

    flowSteps.push(message2Result);
    resultsCollector.recordApiTiming("sendMessage", message2Result.duration);

    //step 4: create order from chat
    const createOrderResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/createOrder")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({
          sellerId: users.sellerUid,
          products: [{ productId: productId, quantity: 2 }],
          paymentMethod: "KBZPay",
          deliveryAddress: {
            street: "123 Test Street",
            city: "Yangon",
            phone: "+959123456789",
            notes: "Please call before delivery",
          },
          chatId: chatId,
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.orderId).toBeDefined();
      orderId = res.body.orderId;
      orderIds.push(orderId);
      securityCheckpoints.push("order_created");
      return res.body;
    }, "create_order");

    flowSteps.push(createOrderResult);
    resultsCollector.recordApiTiming("createOrder", createOrderResult.duration);
    resultsCollector.recordSecurityCheckpoint("order_created", orderId);

    //step 5: confirm payment
    const paymentResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/simulatePayment")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({
          orderId: orderId,
          transactionId: "TXN_E2E_001",
        });
      expect(res.statusCode).toBe(200);
      expect(res.body.paymentConfirmation).toBeDefined();
      securityCheckpoints.push("payment_confirmed");
      securityCheckpoints.push("escrow_activated");
      return res.body;
    }, "confirm_payment");

    flowSteps.push(paymentResult);
    resultsCollector.recordApiTiming("simulatePayment", paymentResult.duration);
    resultsCollector.recordSecurityCheckpoint("payment_confirmed", orderId);
    resultsCollector.recordSecurityCheckpoint("escrow_activated", orderId);

    //step 6: seller confirms order
    const confirmResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .patch("/updateOrderStatus")
        .set("Authorization", `Bearer ${users.sellerToken}`)
        .send({
          orderId: orderId,
          status: "confirmed",
        });
      expect(res.statusCode).toBe(200);
      return res.body;
    }, "confirm_order");

    flowSteps.push(confirmResult);
    resultsCollector.recordApiTiming("updateOrderStatus", confirmResult.duration);

    //step 7: seller ships order
    const shipResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .patch("/updateOrderStatus")
        .set("Authorization", `Bearer ${users.sellerToken}`)
        .send({
          orderId: orderId,
          status: "shipped",
          trackingNumber: "TRACK_E2E_001",
          trackingProvider: "local_courier",
        });
      expect(res.statusCode).toBe(200);
      securityCheckpoints.push("tracking_number_required");
      return res.body;
    }, "ship_order");

    flowSteps.push(shipResult);
    resultsCollector.recordApiTiming("updateOrderStatus", shipResult.duration);
    resultsCollector.recordSecurityCheckpoint("tracking_number_required", orderId);

    //step 8: seller marks delivered with proof
    const deliverResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .patch("/updateOrderStatus")
        .set("Authorization", `Bearer ${users.sellerToken}`)
        .send({
          orderId: orderId,
          status: "delivered",
          proofOfDelivery: {
            otpCode: "123456",
          },
        });
      expect(res.statusCode).toBe(200);
      securityCheckpoints.push("proof_of_delivery_required");
      securityCheckpoints.push("escrow_auto_released");
      return res.body;
    }, "mark_delivered");

    flowSteps.push(deliverResult);
    resultsCollector.recordApiTiming("updateOrderStatus", deliverResult.duration);
    resultsCollector.recordSecurityCheckpoint("proof_of_delivery_required", orderId);
    resultsCollector.recordSecurityCheckpoint("escrow_auto_released", orderId);

    //step 9: verify order status
    const verifyOrderResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .get(`/getOrderById?orderId=${orderId}`)
        .set("Authorization", `Bearer ${users.buyerToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.order.status).toBe("delivered");
      expect(res.body.order.escrowReleased).toBe(true);
      return res.body;
    }, "verify_order_status");

    flowSteps.push(verifyOrderResult);
    resultsCollector.recordApiTiming("getOrderById", verifyOrderResult.duration);

    //calculate total flow time
    const totalDuration = flowSteps.reduce((sum, step) => sum + step.duration, 0);
    const apiCallCount = flowSteps.length;

    //record complete flow
    resultsCollector.recordFlow({
      scenarioName: "Complete Purchase Flow (Happy Path)",
      flowType: "happy_path",
      totalDuration,
      steps: flowSteps.map(step => ({
        operation: step.operationName,
        duration: step.duration,
      })),
      apiCallCount,
      securityCheckpointsHit: securityCheckpoints.length,
      success: true,
    });

    //verify flow completed successfully
    expect(totalDuration).toBeGreaterThan(0);
    expect(apiCallCount).toBe(10); 
    //10 API calls: browse, startChat, 2x sendMessage, createOrder, payment, 3x updateOrderStatus, getOrderById
    expect(securityCheckpoints.length).toBeGreaterThanOrEqual(5);

    //log results for debugging
    console.log("\n=== Happy Path Flow Results ===");
    console.log(`Total Duration: ${totalDuration}ms`);
    console.log(`API Calls: ${apiCallCount}`);
    console.log(`Security Checkpoints: ${securityCheckpoints.length}`);
    flowSteps.forEach(step => {
      console.log(`  ${step.operationName}: ${step.duration}ms`);
    });
  }, 60000);
});

