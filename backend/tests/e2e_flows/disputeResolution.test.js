/**
 * END-TO-END TEST: DISPUTE RESOLUTION & AUDIT TRAIL
 * demonstrates complete audit trail for dispute resolution
 * 
 * test scenarios:
 * 1. complete audit trail for dispute resolution
 * 2. retrieve chat history for dispute context
 */

const request = require("supertest");
const { BASE_URL } = require("../helpers/testSetup");
const { setupE2EUsers, cleanupE2EUsers } = require("./sharedSetup");
const { cleanupTestData } = require("../helpers/cleanupHelpers");
const { createTestProduct } = require("../helpers/productHelpers");
const { createTestChat } = require("../helpers/chatHelpers");
const { measureTime } = require("../helpers/timingHelpers");
const resultsCollector = require("../helpers/resultsCollector");

describe("End-to-End: Dispute Resolution & Audit Trail", () => {
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
      name: "Dispute Test Product",
      price: 20000,
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

  test("Complete audit trail for dispute resolution", async () => {
    //create complete order flow
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
            street: "123 Test St",
            city: "Yangon",
            phone: "+959123456789",
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
        transactionId: "TXN_DISPUTE_001", //required field
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
        trackingNumber: "TRACK_DISPUTE_001",
      });

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${users.sellerToken}`)
      .send({
        orderId: orderId.result,
        status: "delivered",
        proofOfDelivery: { otpCode: "123456" },
      });

    //small delay to ensure all events (including escrow_released) are logged
    await new Promise(resolve => setTimeout(resolve, 500));

    //retrieve audit trail (admin only)
    const auditTrailResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .get(`/getOrderLogs?orderId=${orderId.result}`)
        .set("Authorization", `Bearer ${users.adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.logs).toBeDefined();
      return res.body;
    }, "get_audit_trail");

    resultsCollector.recordApiTiming("getOrderLogs", auditTrailResult.duration);

    //verify audit trail completeness
    const logs = auditTrailResult.result.logs;
    const eventTypes = logs.map(log => log.eventType);

    expect(logs.length).toBeGreaterThan(0);
    expect(eventTypes).toContain("order_created");
    expect(eventTypes).toContain("payment_confirmed");
    expect(eventTypes).toContain("status_updated");
    expect(eventTypes).toContain("tracking_number_added");
    expect(eventTypes).toContain("delivery_proof_submitted");
    expect(eventTypes).toContain("escrow_released");

    //record audit trail completeness
    resultsCollector.recordAuditTrailCompleteness(
      orderId.result,
      logs.length,
      eventTypes
    );

    //verify logs are chronological
    //helper function to convert various timestamp formats to milliseconds
    const timestampToMillis = (ts) => {
      if (!ts) return 0;
      //firestore timestamp object
      if (typeof ts.toMillis === "function") {
        return ts.toMillis();
      }
      //already a number (milliseconds)
      if (typeof ts === "number") {
        return ts;
      }
      //serialized timestamp object with _seconds and _nanoseconds
      if (ts._seconds !== undefined) {
        return ts._seconds * 1000 + (ts._nanoseconds || 0) / 1000000;
      }
      //try to parse as date string
      const parsed = Date.parse(ts);
      if (!isNaN(parsed)) {
        return parsed;
      }
      return 0;
    };

    for (let i = 1; i < logs.length; i++) {
      const prevTime = timestampToMillis(logs[i - 1].timestamp);
      const currTime = timestampToMillis(logs[i].timestamp);
      expect(currTime).toBeGreaterThanOrEqual(prevTime);
    }

    console.log(`\n=== Audit Trail Completeness ===`);
    console.log(`Order ID: ${orderId.result}`);
    console.log(`Total Events Logged: ${logs.length}`);
    console.log(`Event Types: ${eventTypes.join(", ")}`);
  }, 30000);

  test("Retrieve chat history for dispute context", async () => {
    const chatId = await createTestChat(users.buyerUid, users.sellerUid, productId);
    chatIds.push(chatId);

    //send multiple messages
    await request(BASE_URL)
      .post("/sendMessage")
      .set("Authorization", `Bearer ${users.buyerToken}`)
      .send({
        chatId: chatId,
        text: "Is this product authentic?", //API expects "text", not "messageText"
        productId: productId,
      });

    await request(BASE_URL)
      .post("/sendMessage")
      .set("Authorization", `Bearer ${users.sellerToken}`)
      .send({
        chatId: chatId,
        text: "Yes, 100% authentic with warranty", //API expects "text", not "messageText"
      });

    //small delay to ensure messages are written to Firestore
    await new Promise(resolve => setTimeout(resolve, 1000));

    //retrieve chat history
    const chatHistoryResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .get(`/getChatMessages?chatId=${chatId}`)
        .set("Authorization", `Bearer ${users.buyerToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.messages).toBeDefined();
      return res.body;
    }, "get_chat_history");

    resultsCollector.recordApiTiming("getChatMessages", chatHistoryResult.duration);

    expect(chatHistoryResult.result.messages.length).toBe(2);
    //messages are returned with "text" field (from Firestore)
    //first message should be buyer's message (oldest first due to orderBy timestamp asc)
    expect(chatHistoryResult.result.messages[0].text).toContain("authentic");
    //second message should be seller's response
    expect(chatHistoryResult.result.messages[1].text).toContain("100% authentic");
  }, 30000);
});

