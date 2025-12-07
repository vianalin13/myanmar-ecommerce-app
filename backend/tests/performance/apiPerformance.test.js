/**
 * API PERFORMANCE TESTS
 * measures individual API response times for performance metrics
 * 
 * tests:
 * - createOrder API response time
 * - updateOrderStatus API response time
 * - sendMessage API response time
 * - simulatePayment API response time
 * - getPublicProducts API response time
 * - getUserOrders API response time
 * - getChatMessages API response time
 */

const request = require("supertest");
const { BASE_URL } = require("../testSetup");
const { createAuthUserAndGetToken } = require("../auth/authHelpers");
const { cleanupTestData } = require("../cleanupHelpers");
const { createTestProduct } = require("../products/productHelpers");
const { createTestChat } = require("../chat/chatHelpers");
const { createTestOrder } = require("../orders/orderHelpers");
const { measureTime } = require("../e2e/timingHelpers");
const resultsCollector = require("../resultsCollector");

describe("API Performance Tests", () => {
  let buyerUid;
  let sellerUid;
  let buyerToken;
  let sellerToken;
  let productId;
  let orderId;
  let chatId;
  let productIds = [];
  let orderIds = [];
  let chatIds = [];

  beforeEach(async () => {
    const timestamp = Date.now();
    buyerUid = `PERF_BUYER_${timestamp}`;
    sellerUid = `PERF_SELLER_${timestamp}`;

    buyerToken = await createAuthUserAndGetToken(buyerUid, "buyer", "unverified");
    sellerToken = await createAuthUserAndGetToken(sellerUid, "seller", "verified");

    productId = await createTestProduct(sellerToken, {
      name: "Performance Test Product",
      price: 10000,
      stock: 100,
      category: "Test",
    });
    productIds.push(productId);
  }, 30000);

  afterEach(async () => {
    await cleanupTestData({
      buyerUid,
      sellerUid,
      productIds,
      orderIds,
      chatIds,
    });
    productIds = [];
    orderIds = [];
    chatIds = [];
  }, 30000);

  test("Measure getPublicProducts API response time", async () => {
    //run multiple iterations for statistical accuracy
    const iterations = 10;
    const timings = [];

    for (let i = 0; i < iterations; i++) {
      const result = await measureTime(async () => {
        const res = await request(BASE_URL)
          .get("/getPublicProducts")
          .query({ limit: 10 });
        return res;
      }, "getPublicProducts");

      if (result.result && result.result.statusCode === 200) {
        timings.push(result.duration);
        resultsCollector.recordApiTiming("getPublicProducts", result.duration, true, "performance");
      }
    }

    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(`getPublicProducts: Average ${avgTime.toFixed(2)}ms over ${iterations} iterations`);
  }, 60000);

  test("Measure createOrder API response time", async () => {
    chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);

    const iterations = 5;
    const timings = [];

    for (let i = 0; i < iterations; i++) {
      const result = await measureTime(async () => {
        const res = await request(BASE_URL)
          .post("/createOrder")
          .set("Authorization", `Bearer ${buyerToken}`)
          .send({
            sellerId: sellerUid,
            products: [{ productId: productId, quantity: 1 }],
            chatId: chatId,
            paymentMethod: "COD",
            deliveryAddress: {
              street: "Test Address",
              city: "Yangon",
              phone: "+959123456789",
            },
          });
        return res;
      }, "createOrder");

      if (result.result && result.result.statusCode === 200) {
        timings.push(result.duration);
        resultsCollector.recordApiTiming("createOrder", result.duration, true, "performance");
        if (result.result.body && result.result.body.orderId) {
          orderIds.push(result.result.body.orderId);
        }
      } else {
        console.error(`createOrder iteration ${i + 1} failed:`, result.result?.body, "Status:", result.result?.statusCode);
        resultsCollector.recordApiTiming("createOrder", result.duration, false, "performance");
      }
    }

    if (timings.length === 0) {
      throw new Error("All createOrder iterations failed - check error messages above");
    }

    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(`createOrder: Average ${avgTime.toFixed(2)}ms over ${timings.length}/${iterations} successful iterations`);
  }, 120000);

  test("Measure updateOrderStatus API response time", async () => {
    chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);

    try {
      orderId = await createTestOrder({
        buyerToken: buyerToken,
        sellerId: sellerUid,
        products: [{ productId: productId, quantity: 1 }],
        chatId: chatId,
        paymentMethod: "COD",
      });
      orderIds.push(orderId);
    } catch (error) {
      console.error("Failed to create order for updateOrderStatus test:", error.message);
      throw error;
    }

    const statuses = ["confirmed", "shipped", "delivered"];
    const timings = [];

    for (const status of statuses) {
      const result = await measureTime(async () => {
        const res = await request(BASE_URL)
          .post("/updateOrderStatus")
          .set("Authorization", `Bearer ${sellerToken}`)
          .send({
            orderId: orderId,
            status: status,
            ...(status === "shipped" ? { trackingNumber: "TRACK123" } : {}),
            ...(status === "delivered" ? {
              proofOfDelivery: {
                photoURL: "https://example.com/proof123.jpg",
                deliveryNotes: "Delivered successfully",
              },
            } : {}),
          });
        return res;
      }, `updateOrderStatus_${status}`);

      if (result.result && result.result.statusCode === 200) {
        timings.push(result.duration);
        resultsCollector.recordApiTiming("updateOrderStatus", result.duration, true, "performance");
      }
    }

    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(`updateOrderStatus: Average ${avgTime.toFixed(2)}ms over ${statuses.length} status updates`);
  }, 120000);

  test("Measure sendMessage API response time", async () => {
    chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);

    const iterations = 10;
    const timings = [];

    for (let i = 0; i < iterations; i++) {
      const result = await measureTime(async () => {
        const res = await request(BASE_URL)
          .post("/sendMessage")
          .set("Authorization", `Bearer ${buyerToken}`)
          .send({
            chatId: chatId,
            text: `Performance test message ${i}`,
          });
        return res;
      }, "sendMessage");

      if (result.result && result.result.statusCode === 200) {
        timings.push(result.duration);
        resultsCollector.recordApiTiming("sendMessage", result.duration, true, "performance");
      }
    }

    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(`sendMessage: Average ${avgTime.toFixed(2)}ms over ${iterations} iterations`);
  }, 120000);

  test("Measure simulatePayment API response time", async () => {
    chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);

    try {
      orderId = await createTestOrder({
        buyerToken: buyerToken,
        sellerId: sellerUid,
        products: [{ productId: productId, quantity: 1 }],
        chatId: chatId,
        paymentMethod: "KBZPay",
      });
      orderIds.push(orderId);
    } catch (error) {
      console.error("Failed to create order for simulatePayment test:", error.message);
      throw error;
    }

    const iterations = 5;
    const timings = [];

    for (let i = 0; i < iterations; i++) {
      // Create a new order for each payment test
      const testOrderId = await createTestOrder({
        buyerToken: buyerToken,
        sellerId: sellerUid,
        products: [{ productId: productId, quantity: 1 }],
        chatId: chatId,
        paymentMethod: "KBZPay",
      });
      orderIds.push(testOrderId);

      const result = await measureTime(async () => {
        const res = await request(BASE_URL)
          .post("/simulatePayment")
          .set("Authorization", `Bearer ${buyerToken}`)
          .send({
            orderId: testOrderId,
            paymentMethod: "kbzpay",
            transactionId: `TXN_${Date.now()}_${i}`,
          });
        return res;
      }, "simulatePayment");

      if (result.result && result.result.statusCode === 200) {
        timings.push(result.duration);
        resultsCollector.recordApiTiming("simulatePayment", result.duration, true, "performance");
      }
    }

    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(`simulatePayment: Average ${avgTime.toFixed(2)}ms over ${iterations} iterations`);
  }, 180000);

  test("Measure getUserOrders API response time", async () => {
    chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);

    //create multiple orders
    for (let i = 0; i < 3; i++) {
      try {
        const testOrderId = await createTestOrder({
          buyerToken: buyerToken,
          sellerId: sellerUid,
          products: [{ productId: productId, quantity: 1 }],
          chatId: chatId,
          paymentMethod: "COD",
        });
        orderIds.push(testOrderId);
      } catch (error) {
        console.error(`Failed to create order ${i + 1} for getUserOrders test:`, error.message);
        //continue with other orders even if one fails
      }
    }

    const iterations = 10;
    const timings = [];

    for (let i = 0; i < iterations; i++) {
      const result = await measureTime(async () => {
        const res = await request(BASE_URL)
          .get("/getUserOrders")
          .set("Authorization", `Bearer ${buyerToken}`)
          .query({ limit: 10 });
        return res;
      }, "getUserOrders");

      if (result.result && result.result.statusCode === 200) {
        timings.push(result.duration);
        resultsCollector.recordApiTiming("getUserOrders", result.duration, true, "performance");
      }
    }

    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(`getUserOrders: Average ${avgTime.toFixed(2)}ms over ${iterations} iterations`);
  }, 120000);

  test("Measure concurrent browsing performance", async () => {
    const concurrentUsers = 5;
    const operations = [];

    for (let i = 0; i < concurrentUsers; i++) {
      operations.push({
        name: `concurrent_browse_${i}`,
        fn: async () => {
          const res = await request(BASE_URL)
            .get("/getPublicProducts")
            .query({ limit: 10 });
          if (res.statusCode !== 200) {
            throw new Error(`Failed to browse: ${res.statusCode}`);
          }
          return res;
        },
      });
    }

    const startTime = Date.now();
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
    const throughput = (successCount / (totalDuration / 1000)).toFixed(2);

    console.log(`Concurrent browsing (${concurrentUsers} users): ${throughput} requests/second`);
    console.log(`Success: ${successCount}/${concurrentUsers} in ${totalDuration}ms`);

    resultsCollector.recordThroughput(
      "concurrent_browse",
      parseFloat(throughput),
      successCount,
      totalDuration,
      "performance"
    );

    //record individual API timings
    results.forEach(result => {
      if (result.success && result.duration !== null) {
        resultsCollector.recordApiTiming("getPublicProducts", result.duration, true, "performance");
      }
    });

    expect(successCount).toBe(concurrentUsers);
  }, 60000);

  test("Measure getChatMessages API response time", async () => {
    chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);

    //send multiple messages first
    for (let i = 0; i < 5; i++) {
      await request(BASE_URL)
        .post("/sendMessage")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          chatId: chatId,
          text: `Test message ${i}`,
        });
    }

    const iterations = 10;
    const timings = [];

    for (let i = 0; i < iterations; i++) {
      const result = await measureTime(async () => {
        const res = await request(BASE_URL)
          .get("/getChatMessages")
          .set("Authorization", `Bearer ${buyerToken}`)
          .query({ chatId: chatId, limit: 10 });
        return res;
      }, "getChatMessages");

      if (result.result && result.result.statusCode === 200) {
        timings.push(result.duration);
        resultsCollector.recordApiTiming("getChatMessages", result.duration, true, "performance");
      }
    }

    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(`getChatMessages: Average ${avgTime.toFixed(2)}ms over ${iterations} iterations`);
  }, 120000);
});

