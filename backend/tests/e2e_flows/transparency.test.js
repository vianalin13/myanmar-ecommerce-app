/**
 * END-TO-END TEST: TRANSPARENCY DEMONSTRATION
 * demonstrates complete audit trail transparency vs. Facebook/WeChat
 * 
 * this test validates that every transaction step is logged and retrievable,
 * showing the transparency advantage over social media platforms.
 * 
 * test scenarios:
 * 1. complete transaction transparency - all events logged
 * 2. audit trail completeness measurement
 * 3. comparison with Facebook/WeChat (theoretical - 0 events logged)
 */

const request = require("supertest");
const { BASE_URL } = require("../helpers/testSetup");
const { setupE2EUsers, cleanupE2EUsers } = require("./sharedSetup");
const { cleanupTestData } = require("../helpers/cleanupHelpers");
const { createTestProduct } = require("../helpers/productHelpers");
const { createTestChat } = require("../helpers/chatHelpers");
const { measureTime } = require("../helpers/timingHelpers");
const resultsCollector = require("../helpers/resultsCollector");

describe("End-to-End: Transparency Demonstration", () => {
  let users;
  let productId;
  let productIds = [];
  let orderIds = [];
  let chatIds = [];

  beforeAll(async () => {
    users = await setupE2EUsers();
  }, 30000);

  beforeEach(async () => {
    productId = await createTestProduct(users.sellerToken, {
      name: "Transparency Test Product",
      price: 25000,
      stock: 5,
      category: "Test",
    });
    productIds.push(productId);
  }, 30000);

  afterEach(async () => {
    await cleanupTestData({
      productIds,
      orderIds,
      chatIds,
    });
    productIds = [];
    orderIds = [];
    chatIds = [];
  }, 30000);

  afterAll(async () => {
    await cleanupE2EUsers(users);
  }, 30000);

  test("Complete transaction transparency - all events logged and retrievable", async () => {
    const transactionSteps = [];
    const loggedEvents = [];

    //step 1: browse products
    const browseResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .get("/getPublicProducts");
      expect(res.statusCode).toBe(200);
      return res.body.products;
    }, "browse_products");
    transactionSteps.push({ step: "Browse Products", duration: browseResult.duration });

    //step 2: start chat
    const chatId = await createTestChat(users.buyerUid, users.sellerUid, productId);
    chatIds.push(chatId);
    const chatResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/startChat")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({
          sellerId: users.sellerUid,
          productId: productId,
        });
      expect(res.statusCode).toBe(200);
      return res.body;
    }, "start_chat");
    transactionSteps.push({ step: "Start Chat", duration: chatResult.duration });

    //step 3: exchange messages
    await request(BASE_URL)
      .post("/sendMessage")
      .set("Authorization", `Bearer ${users.buyerToken}`)
      .send({
        chatId: chatId,
        text: "Is this available?",
        productId: productId,
      });
    await request(BASE_URL)
      .post("/sendMessage")
      .set("Authorization", `Bearer ${users.sellerToken}`)
      .send({
        chatId: chatId,
        text: "Yes, available!",
      });
    transactionSteps.push({ step: "Exchange Messages", duration: 0 });

    //step 4: create order
    const orderId = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/createOrder")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({
          sellerId: users.sellerUid,
          products: [{ productId: productId, quantity: 1 }],
          paymentMethod: "KBZPay",
          deliveryAddress: {
            street: "123 Transparency St",
            city: "Yangon",
            phone: "+959123456789",
          },
          chatId: chatId,
        });
      expect(res.statusCode).toBe(200);
      orderIds.push(res.body.orderId);
      loggedEvents.push("order_created");
      return res.body.orderId;
    }, "create_order");
    transactionSteps.push({ step: "Create Order", duration: orderId.duration });

    //step 5: confirm payment
    const paymentResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/simulatePayment")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({
          orderId: orderId.result,
          transactionId: "TXN_TRANSPARENCY_001",
        });
      expect(res.statusCode).toBe(200);
      loggedEvents.push("payment_confirmed");
      return res.body;
    }, "confirm_payment");
    transactionSteps.push({ step: "Confirm Payment", duration: paymentResult.duration });

    //step 6: seller confirms order
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${users.sellerToken}`)
      .send({ orderId: orderId.result, status: "confirmed" });
    loggedEvents.push("status_updated");

    //step 7: seller ships order
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${users.sellerToken}`)
      .send({
        orderId: orderId.result,
        status: "shipped",
        trackingNumber: "TRACK_TRANSPARENCY_001",
      });
    loggedEvents.push("status_updated");
    loggedEvents.push("tracking_number_added");

    //step 8: seller marks delivered
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${users.sellerToken}`)
      .send({
        orderId: orderId.result,
        status: "delivered",
        proofOfDelivery: { otpCode: "123456" },
      });
    loggedEvents.push("status_updated");
    loggedEvents.push("delivery_proof_submitted");
    loggedEvents.push("escrow_released");

    //small delay to ensure all events are logged
    await new Promise(resolve => setTimeout(resolve, 500));

    //retrieve complete audit trail
    const auditTrailResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .get(`/getOrderLogs?orderId=${orderId.result}`)
        .set("Authorization", `Bearer ${users.adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.logs).toBeDefined();
      return res.body;
    }, "get_audit_trail");

    resultsCollector.recordApiTiming("getOrderLogs", auditTrailResult.duration);

    //analyze audit trail completeness
    const logs = auditTrailResult.result.logs;
    const eventTypes = logs.map(log => log.eventType);
    const uniqueEventTypes = [...new Set(eventTypes)];

    //verify all expected events are logged
    expect(logs.length).toBeGreaterThan(0);
    expect(eventTypes).toContain("order_created");
    expect(eventTypes).toContain("payment_confirmed");
    expect(eventTypes).toContain("status_updated");
    expect(eventTypes).toContain("tracking_number_added");
    expect(eventTypes).toContain("delivery_proof_submitted");
    expect(eventTypes).toContain("escrow_released");

    //calculate transparency metrics
    const totalTransactionSteps = transactionSteps.length;
    const totalEventsLogged = logs.length;
    const uniqueEventTypesCount = uniqueEventTypes.length;
    const transparencyPercentage = (totalEventsLogged / totalTransactionSteps) * 100;

    //record transparency metrics
    resultsCollector.recordTransparencyMetrics({
      orderId: orderId.result,
      totalTransactionSteps,
      totalEventsLogged,
      uniqueEventTypesCount,
      transparencyPercentage,
      eventTypes: uniqueEventTypes,
      transactionDuration: transactionSteps.reduce((sum, step) => sum + step.duration, 0),
    });

    //compare with Facebook/WeChat (theoretical - 0 events logged)
    const facebookWeChatEvents = 0; //no structured logging
    const transparencyAdvantage = totalEventsLogged - facebookWeChatEvents;

    console.log("\n=== TRANSPARENCY DEMONSTRATION ===");
    console.log(`Order ID: ${orderId.result}`);
    console.log(`Total Transaction Steps: ${totalTransactionSteps}`);
    console.log(`Total Events Logged: ${totalEventsLogged}`);
    console.log(`Unique Event Types: ${uniqueEventTypesCount}`);
    console.log(`Transparency Coverage: ${transparencyPercentage.toFixed(1)}%`);
    console.log(`\nEvent Types Logged:`);
    uniqueEventTypes.forEach((eventType, index) => {
      const count = eventTypes.filter(e => e === eventType).length;
      console.log(`  ${index + 1}. ${eventType} (${count} occurrence${count > 1 ? 's' : ''})`);
    });
    console.log(`\nComparison with Facebook/WeChat:`);
    console.log(`  Your App: ${totalEventsLogged} events logged`);
    console.log(`  Facebook/WeChat: ${facebookWeChatEvents} events logged (no structured logging)`);
    console.log(`  Transparency Advantage: +${transparencyAdvantage} events`);

    //verify transparency advantage
    expect(totalEventsLogged).toBeGreaterThan(facebookWeChatEvents);
    expect(transparencyPercentage).toBeGreaterThan(0);
  }, 30000);

  test("Audit trail completeness measurement", async () => {
    //create a complete order flow
    const chatId = await createTestChat(users.buyerUid, users.sellerUid, productId);
    chatIds.push(chatId);

    const orderId = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/createOrder")
        .set("Authorization", `Bearer ${users.buyerToken}`)
        .send({
          sellerId: users.sellerUid,
          products: [{ productId: productId, quantity: 1 }],
          paymentMethod: "KBZPay",
          deliveryAddress: {
            street: "456 Completeness St",
            city: "Yangon",
            phone: "+959987654321",
          },
          chatId: chatId,
        });
      orderIds.push(res.body.orderId);
      return res.body.orderId;
    }, "create_order");

    //complete order flow
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${users.buyerToken}`)
      .send({
        orderId: orderId.result,
        transactionId: "TXN_COMPLETE_001",
      });

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${users.sellerToken}`)
      .send({ orderId: orderId.result, status: "confirmed" });

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${users.sellerToken}`)
      .send({
        orderId: orderId.result,
        status: "shipped",
        trackingNumber: "TRACK_COMPLETE_001",
      });

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${users.sellerToken}`)
      .send({
        orderId: orderId.result,
        status: "delivered",
        proofOfDelivery: { otpCode: "654321" },
      });

    //wait for all events to be logged
    await new Promise(resolve => setTimeout(resolve, 500));

    //retrieve audit trail
    const auditTrailResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .get(`/getOrderLogs?orderId=${orderId.result}`)
        .set("Authorization", `Bearer ${users.adminToken}`);
      expect(res.statusCode).toBe(200);
      return res.body;
    }, "get_audit_trail");

    const logs = auditTrailResult.result.logs;
    const eventTypes = logs.map(log => log.eventType);

    //measure completeness
    const expectedEvents = [
      "order_created",
      "payment_confirmed",
      "status_updated", // Multiple occurrences expected
      "tracking_number_added",
      "delivery_proof_submitted",
      "escrow_released",
    ];

    const foundEvents = expectedEvents.filter(event => eventTypes.includes(event));
    const completenessScore = (foundEvents.length / expectedEvents.length) * 100;

    //record completeness metrics
    resultsCollector.recordAuditTrailCompleteness(
      orderId.result,
      logs.length,
      eventTypes
    );

    console.log("\n=== AUDIT TRAIL COMPLETENESS ===");
    console.log(`Order ID: ${orderId.result}`);
    console.log(`Total Events Logged: ${logs.length}`);
    console.log(`Expected Event Types: ${expectedEvents.length}`);
    console.log(`Found Event Types: ${foundEvents.length}`);
    console.log(`Completeness Score: ${completenessScore.toFixed(1)}%`);
    console.log(`\nFound Events:`);
    foundEvents.forEach(event => console.log(`  ✓ ${event}`));
    console.log(`\nMissing Events:`);
    expectedEvents.filter(e => !foundEvents.includes(e)).forEach(event => {
      console.log(`  ✗ ${event}`);
    });

    //verify high completeness
    expect(completenessScore).toBeGreaterThanOrEqual(80); // at least 80% completeness
    expect(logs.length).toBeGreaterThanOrEqual(5); // at least 5 events logged
  }, 30000);
});

