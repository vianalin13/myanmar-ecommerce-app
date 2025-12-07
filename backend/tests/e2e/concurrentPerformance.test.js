/**
 * END-TO-END TEST: CONCURRENT USER PERFORMANCE
 * tests system performance under concurrent load
 * 
 * test scenarios:
 * 1. multiple users browsing products simultaneously
 * 2. multiple users sending messages simultaneously
 */

const request = require("supertest");
const { BASE_URL } = require("../helpers/testSetup");
const { setupE2EUsers, cleanupE2EUsers } = require("./sharedSetup");
const { cleanupTestData } = require("../helpers/cleanupHelpers");
const { createTestProduct } = require("../helpers/productHelpers");
const { createTestChat } = require("../helpers/chatHelpers");
const { measureMultipleOperations } = require("../helpers/timingHelpers");
const resultsCollector = require("../helpers/resultsCollector");

describe("End-to-End: Concurrent User Performance", () => {
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
      name: "Concurrent Test Product",
      price: 15000,
      stock: 100,
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

  test("Multiple users browsing products simultaneously", async () => {
    const concurrentUsers = 5;
    const browseOperations = [];

    for (let i = 0; i < concurrentUsers; i++) {
      browseOperations.push({
        name: `browse_user_${i + 1}`,
        fn: async () => {
          const res = await request(BASE_URL).get("/getPublicProducts");
          expect(res.statusCode).toBe(200);
          return res.body;
        },
      });
    }

    const results = await measureMultipleOperations(browseOperations);
    const successCount = results.filter(r => r.success).length;
    const avgDuration = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + r.duration, 0) / successCount;

    expect(successCount).toBe(concurrentUsers);

    resultsCollector.recordConcurrentTest({
      userCount: concurrentUsers,
      successCount,
      failureCount: concurrentUsers - successCount,
      averageDuration: Math.round(avgDuration * 100) / 100,
      testType: "concurrent_browse",
    });

    console.log(`\n=== Concurrent Browse Test ===`);
    console.log(`Users: ${concurrentUsers}`);
    console.log(`Success Rate: ${(successCount / concurrentUsers) * 100}%`);
    console.log(`Average Duration: ${avgDuration}ms`);
  }, 30000);

  test("Multiple users sending messages simultaneously", async () => {
    const chatId = await createTestChat(users.buyerUid, users.sellerUid, productId);
    chatIds.push(chatId);

    const concurrentMessages = 10;
    const messageOperations = [];

    for (let i = 0; i < concurrentMessages; i++) {
      messageOperations.push({
        name: `send_message_${i + 1}`,
        fn: async () => {
          const res = await request(BASE_URL)
            .post("/sendMessage")
            .set("Authorization", `Bearer ${users.buyerToken}`)
            .send({
              chatId: chatId,
              text: `Concurrent message ${i + 1}`, //API expects "text", not "messageText"
            });
          expect(res.statusCode).toBe(200);
          return res.body;
        },
      });
    }

    const results = await measureMultipleOperations(messageOperations);
    const successCount = results.filter(r => r.success).length;
    const successfulResults = results.filter(r => r.success);
    const totalDuration = successfulResults.reduce((sum, r) => sum + (r.duration || 0), 0);
    const avgDuration = successCount > 0 ? totalDuration / successCount : 0;
    const throughput = successCount > 0 && totalDuration > 0 
      ? (successCount / (totalDuration / 1000)).toFixed(2)
      : "0.00";

    expect(successCount).toBe(concurrentMessages);

    resultsCollector.recordConcurrentTest({
      userCount: concurrentMessages,
      successCount,
      failureCount: concurrentMessages - successCount,
      averageDuration: Math.round(avgDuration * 100) / 100,
      testType: "concurrent_messaging",
      throughput: parseFloat(throughput),
    });

    console.log(`\n=== Concurrent Messaging Test ===`);
    console.log(`Messages: ${concurrentMessages}`);
    console.log(`Success Rate: ${(successCount / concurrentMessages) * 100}%`);
    console.log(`Average Duration: ${avgDuration}ms`);
    console.log(`Throughput: ${throughput} messages/second`);
  }, 30000);
});

