/**
 * CHAT MESSAGE THROUGHPUT TESTS
 * measures how many messages can be sent/retrieved per second
 * 
 * tests:
 * - single user message sending throughput
 * - concurrent users sending messages simultaneously
 * - message retrieval throughput
 */

const request = require("supertest");
const { BASE_URL } = require("../testSetup");
const { createAuthUserAndGetToken } = require("../auth/authHelpers");
const { cleanupTestData } = require("../cleanupHelpers");
const { createTestProduct } = require("../products/productHelpers");
const { createTestChat } = require("../chat/chatHelpers");
const { measureTime, measureMultipleOperations } = require("../e2e/timingHelpers");
const resultsCollector = require("../resultsCollector");

describe("Chat Message Throughput Tests", () => {
  let buyerUid;
  let sellerUid;
  let buyerToken;
  let sellerToken;
  let productId;
  let chatId;
  let productIds = [];
  let chatIds = [];

  beforeEach(async () => {
    const timestamp = Date.now();
    buyerUid = `THROUGHPUT_BUYER_${timestamp}`;
    sellerUid = `THROUGHPUT_SELLER_${timestamp}`;

    buyerToken = await createAuthUserAndGetToken(buyerUid, "buyer", "unverified");
    sellerToken = await createAuthUserAndGetToken(sellerUid, "seller", "verified");

    productId = await createTestProduct(sellerToken, {
      name: "Throughput Test Product",
      price: 10000,
      stock: 100,
      category: "Test",
    });
    productIds.push(productId);

    chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);
  }, 30000);

  afterEach(async () => {
    await cleanupTestData({
      buyerUid,
      sellerUid,
      productIds,
      chatIds,
    });
    productIds = [];
    chatIds = [];
  }, 30000);

  test("Measure single user message sending throughput", async () => {
    const messageCount = 20;
    const startTime = Date.now();

    const operations = [];
    for (let i = 0; i < messageCount; i++) {
      operations.push({
        name: `sendMessage_${i}`,
        fn: async () => {
          const res = await request(BASE_URL)
            .post("/sendMessage")
            .set("Authorization", `Bearer ${buyerToken}`)
            .send({
              chatId: chatId,
              text: `Throughput test message ${i}`,
            });
          if (res.statusCode !== 200) {
            throw new Error(`Failed to send message: ${res.statusCode}`);
          }
          return res;
        },
      });
    }

    const results = await measureMultipleOperations(operations);
    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    const successCount = results.filter(r => r.success).length;
    const throughput = (successCount / (totalDuration / 1000)).toFixed(2);

    console.log(`Single user throughput: ${throughput} messages/second`);
    console.log(`Sent ${successCount}/${messageCount} messages in ${totalDuration}ms`);

    resultsCollector.recordThroughput(
      "single_user_message_send",
      parseFloat(throughput),
      successCount,
      totalDuration,
      "performance"
    );

    //record individual API timings
    results.forEach(result => {
      if (result.success && result.duration !== null) {
        resultsCollector.recordApiTiming("sendMessage", result.duration, true, "performance");
      }
    });
  }, 120000);

  test("Measure concurrent users message sending throughput", async () => {
    //create multiple buyer users for concurrent testing
    const concurrentUserCount = 5;
    const messagesPerUser = 5;
    const users = [];

    for (let i = 0; i < concurrentUserCount; i++) {
      const timestamp = Date.now();
      const uid = `CONCURRENT_BUYER_${timestamp}_${i}`;
      const token = await createAuthUserAndGetToken(uid, "buyer", "unverified");
      const userChatId = await createTestChat(uid, sellerUid, productId);
      chatIds.push(userChatId);

      users.push({ uid, token, chatId: userChatId });
    }

    const startTime = Date.now();
    const operations = [];

    //create operations for all users concurrently
    users.forEach((user, userIndex) => {
      for (let i = 0; i < messagesPerUser; i++) {
        operations.push({
          name: `concurrent_send_${userIndex}_${i}`,
          fn: async () => {
            const res = await request(BASE_URL)
              .post("/sendMessage")
              .set("Authorization", `Bearer ${user.token}`)
              .send({
                chatId: user.chatId,
                text: `Concurrent message from user ${userIndex}, message ${i}`,
              });
            if (res.statusCode !== 200) {
              throw new Error(`Failed to send message: ${res.statusCode}`);
            }
            return res;
          },
        });
      }
    });

    //execute all operations concurrently
    const results = await Promise.all(
      operations.map(async op => {
        try {
          const measurement = await measureTime(op.fn, op.name);
          return {
            operationName: measurement.operationName,
            duration: measurement.duration,
            success: !measurement.error,
            error: measurement.error || null,
          };
        } catch (error) {
          return {
            operationName: op.name,
            duration: null,
            success: false,
            error: error.message,
          };
        }
      })
    );

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    const successCount = results.filter(r => r.success).length;
    const totalOperations = operations.length;
    const throughput = (successCount / (totalDuration / 1000)).toFixed(2);

    console.log(`Concurrent throughput (${concurrentUserCount} users): ${throughput} messages/second`);
    console.log(`Sent ${successCount}/${totalOperations} messages in ${totalDuration}ms`);

    resultsCollector.recordThroughput(
      "concurrent_message_send",
      parseFloat(throughput),
      successCount,
      totalDuration,
      "performance"
    );

    //record individual API timings
    results.forEach(result => {
      if (result.success && result.duration !== null) {
        resultsCollector.recordApiTiming("sendMessage", result.duration, true, "performance");
      }
    });

    //cleanup concurrent users
    await Promise.all(
      users.map(user =>
        cleanupTestData({
          buyerUid: user.uid,
        })
      )
    );
  }, 180000);

  test("Measure message retrieval throughput", async () => {
    //send messages first
    const messageCount = 20;
    for (let i = 0; i < messageCount; i++) {
      await request(BASE_URL)
        .post("/sendMessage")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          chatId: chatId,
          text: `Retrieval test message ${i}`,
        });
    }

    const retrievalCount = 30;
    const startTime = Date.now();

    const operations = [];
    for (let i = 0; i < retrievalCount; i++) {
      operations.push({
        name: `getChatMessages_${i}`,
        fn: async () => {
          const res = await request(BASE_URL)
            .get("/getChatMessages")
            .set("Authorization", `Bearer ${buyerToken}`)
            .query({ chatId: chatId, limit: 50 });
          if (res.statusCode !== 200) {
            throw new Error(`Failed to retrieve messages: ${res.statusCode}`);
          }
          return res;
        },
      });
    }

    const results = await measureMultipleOperations(operations);
    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    const successCount = results.filter(r => r.success).length;
    const throughput = (successCount / (totalDuration / 1000)).toFixed(2);

    console.log(`Message retrieval throughput: ${throughput} retrievals/second`);
    console.log(`Retrieved ${successCount}/${retrievalCount} times in ${totalDuration}ms`);

    resultsCollector.recordThroughput(
      "message_retrieval",
      parseFloat(throughput),
      successCount,
      totalDuration,
      "performance"
    );

    //record individual API timings
    results.forEach(result => {
      if (result.success && result.duration !== null) {
        resultsCollector.recordApiTiming("getChatMessages", result.duration, true, "performance");
      }
    });
  }, 120000);
});

