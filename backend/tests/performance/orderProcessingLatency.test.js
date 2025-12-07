/**
 * ORDER PROCESSING LATENCY TESTS
 * measures end-to-end time for complete order lifecycle
 * 
 * tests:
 * - complete order lifecycle timing (creation → payment → delivery)
 * - individual step timings (order creation, payment, shipping, delivery)
 */

const request = require("supertest");
const { BASE_URL } = require("../testSetup");
const { createAuthUserAndGetToken } = require("../auth/authHelpers");
const { cleanupTestData } = require("../cleanupHelpers");
const { createTestProduct } = require("../products/productHelpers");
const { createTestChat } = require("../chat/chatHelpers");
const { measureTime } = require("../e2e/timingHelpers");
const resultsCollector = require("../resultsCollector");

describe("Order Processing Latency Tests", () => {
  let buyerUid;
  let sellerUid;
  let buyerToken;
  let sellerToken;
  let productId;
  let productIds = [];
  let orderIds = [];
  let chatIds = [];

  beforeEach(async () => {
    const timestamp = Date.now();
    buyerUid = `LATENCY_BUYER_${timestamp}`;
    sellerUid = `LATENCY_SELLER_${timestamp}`;

    buyerToken = await createAuthUserAndGetToken(buyerUid, "buyer", "unverified");
    sellerToken = await createAuthUserAndGetToken(sellerUid, "seller", "verified");

    productId = await createTestProduct(sellerToken, {
      name: "Latency Test Product",
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

  test("Measure complete order lifecycle latency (Cash on Delivery)", async () => {
    const chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);

    const stepTimings = {};
    const flowStartTime = Date.now();

    //step 1: create order
    const createOrderResult = await measureTime(async () => {
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
    }, "orderCreation");

    if (createOrderResult.result.statusCode !== 200) {
      console.error("Order creation failed:", createOrderResult.result.body);
      console.error("Status:", createOrderResult.result.statusCode);
    }
    expect(createOrderResult.result.statusCode).toBe(200);
    const orderId = createOrderResult.result.body.orderId;
    orderIds.push(orderId);
    stepTimings.orderCreation = createOrderResult.duration;
    resultsCollector.recordApiTiming("createOrder", createOrderResult.duration, true, "performance");

    //step 2: seller confirms order
    const confirmOrderResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/updateOrderStatus")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          orderId: orderId,
          status: "confirmed",
        });
      return res;
    }, "orderConfirmation");

    expect(confirmOrderResult.result.statusCode).toBe(200);
    stepTimings.orderConfirmation = confirmOrderResult.duration;
    resultsCollector.recordApiTiming("updateOrderStatus", confirmOrderResult.duration, true, "performance");

    //step 3: seller ships order
    const shipOrderResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/updateOrderStatus")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          orderId: orderId,
          status: "shipped",
          trackingNumber: "TRACK123",
        });
      return res;
    }, "shipping");

    expect(shipOrderResult.result.statusCode).toBe(200);
    stepTimings.shipping = shipOrderResult.duration;
    resultsCollector.recordApiTiming("updateOrderStatus", shipOrderResult.duration, true, "performance");

    //step 4: seller marks as delivered
    const deliverOrderResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/updateOrderStatus")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          orderId: orderId,
          status: "delivered",
          proofOfDelivery: {
            photoURL: "https://example.com/proof123.jpg",
            deliveryNotes: "Delivered successfully",
          },
        });
      return res;
    }, "delivery");

    if (deliverOrderResult.result.statusCode !== 200) {
      console.error("Delivery status update failed:", deliverOrderResult.result.body);
      console.error("Status:", deliverOrderResult.result.statusCode);
    }
    expect(deliverOrderResult.result.statusCode).toBe(200);
    stepTimings.delivery = deliverOrderResult.duration;
    resultsCollector.recordApiTiming("updateOrderStatus", deliverOrderResult.duration, true, "performance");

    const flowEndTime = Date.now();
    const totalLatency = flowEndTime - flowStartTime;

    console.log("\n=== Order Processing Latency (Cash on Delivery) ===");
    console.log(`Total Latency: ${totalLatency}ms`);
    console.log(`Order Creation: ${stepTimings.orderCreation}ms`);
    console.log(`Order Confirmation: ${stepTimings.orderConfirmation}ms`);
    console.log(`Shipping: ${stepTimings.shipping}ms`);
    console.log(`Delivery: ${stepTimings.delivery}ms`);

    resultsCollector.recordOrderProcessingLatency(orderId, totalLatency, stepTimings);
  }, 120000);

  test("Measure complete order lifecycle latency (Digital Payment)", async () => {
    const chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);

    const stepTimings = {};
    const flowStartTime = Date.now();

    //step 1: create Order
    const createOrderResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/createOrder")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          sellerId: sellerUid,
          products: [{ productId: productId, quantity: 1 }],
          chatId: chatId,
          paymentMethod: "KBZPay",
          deliveryAddress: {
            street: "Test Address",
            city: "Yangon",
            phone: "+959123456789",
          },
        });
      return res;
    }, "orderCreation");

    if (createOrderResult.result.statusCode !== 200) {
      console.error("Order creation failed (Digital Payment):", createOrderResult.result.body);
      console.error("Status:", createOrderResult.result.statusCode);
    }
    expect(createOrderResult.result.statusCode).toBe(200);
    const orderId = createOrderResult.result.body.orderId;
    orderIds.push(orderId);
    stepTimings.orderCreation = createOrderResult.duration;
    resultsCollector.recordApiTiming("createOrder", createOrderResult.duration, true, "performance");

    //step 2: simulate payment
    const paymentResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/simulatePayment")
        .set("Authorization", `Bearer ${buyerToken}`)
        .send({
          orderId: orderId,
          paymentMethod: "kbzpay",
          transactionId: `TXN_${Date.now()}`,
        });
      return res;
    }, "paymentConfirmation");

    expect(paymentResult.result.statusCode).toBe(200);
    stepTimings.paymentConfirmation = paymentResult.duration;
    resultsCollector.recordApiTiming("simulatePayment", paymentResult.duration, true, "performance");

    //step 3: seller confirms order
    const confirmOrderResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/updateOrderStatus")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          orderId: orderId,
          status: "confirmed",
        });
      return res;
    }, "orderConfirmation");

    expect(confirmOrderResult.result.statusCode).toBe(200);
    stepTimings.orderConfirmation = confirmOrderResult.duration;
    resultsCollector.recordApiTiming("updateOrderStatus", confirmOrderResult.duration, true, "performance");

    //step 4: seller ships order
    const shipOrderResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/updateOrderStatus")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          orderId: orderId,
          status: "shipped",
          trackingNumber: "TRACK123",
        });
      return res;
    }, "shipping");

    expect(shipOrderResult.result.statusCode).toBe(200);
    stepTimings.shipping = shipOrderResult.duration;
    resultsCollector.recordApiTiming("updateOrderStatus", shipOrderResult.duration, true, "performance");

    //step 5: seller marks as delivered
    const deliverOrderResult = await measureTime(async () => {
      const res = await request(BASE_URL)
        .post("/updateOrderStatus")
        .set("Authorization", `Bearer ${sellerToken}`)
        .send({
          orderId: orderId,
          status: "delivered",
          proofOfDelivery: {
            photoURL: "https://example.com/proof123.jpg",
            deliveryNotes: "Delivered successfully",
          },
        });
      return res;
    }, "delivery");

    if (deliverOrderResult.result.statusCode !== 200) {
      console.error("Delivery status update failed (Digital Payment):", deliverOrderResult.result.body);
      console.error("Status:", deliverOrderResult.result.statusCode);
    }
    expect(deliverOrderResult.result.statusCode).toBe(200);
    stepTimings.delivery = deliverOrderResult.duration;
    resultsCollector.recordApiTiming("updateOrderStatus", deliverOrderResult.duration, true, "performance");

    const flowEndTime = Date.now();
    const totalLatency = flowEndTime - flowStartTime;

    console.log("\n=== Order Processing Latency (Digital Payment) ===");
    console.log(`Total Latency: ${totalLatency}ms`);
    console.log(`Order Creation: ${stepTimings.orderCreation}ms`);
    console.log(`Payment Confirmation: ${stepTimings.paymentConfirmation}ms`);
    console.log(`Order Confirmation: ${stepTimings.orderConfirmation}ms`);
    console.log(`Shipping: ${stepTimings.shipping}ms`);
    console.log(`Delivery: ${stepTimings.delivery}ms`);

    resultsCollector.recordOrderProcessingLatency(orderId, totalLatency, stepTimings);
  }, 120000);

  test("Measure multiple order lifecycle latencies for average", async () => {
    const orderCount = 3;
    const latencies = [];

    for (let i = 0; i < orderCount; i++) {
      const chatId = await createTestChat(buyerUid, sellerUid, productId);
      chatIds.push(chatId);

      const flowStartTime = Date.now();
      const stepTimings = {};

      //create order
      const createOrderResult = await measureTime(async () => {
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
      }, "orderCreation");

      const orderId = createOrderResult.result.body.orderId;
      orderIds.push(orderId);
      stepTimings.orderCreation = createOrderResult.duration;

      //confirm
      const confirmResult = await measureTime(async () => {
        const res = await request(BASE_URL)
          .post("/updateOrderStatus")
          .set("Authorization", `Bearer ${sellerToken}`)
          .send({ orderId: orderId, status: "confirmed" });
        return res;
      }, "orderConfirmation");
      stepTimings.orderConfirmation = confirmResult.duration;

      //ship
      const shipResult = await measureTime(async () => {
        const res = await request(BASE_URL)
          .post("/updateOrderStatus")
          .set("Authorization", `Bearer ${sellerToken}`)
          .send({ orderId: orderId, status: "shipped", trackingNumber: "TRACK123" });
        return res;
      }, "shipping");
      stepTimings.shipping = shipResult.duration;

      //deliver
      const deliverResult = await measureTime(async () => {
        const res = await request(BASE_URL)
          .post("/updateOrderStatus")
          .set("Authorization", `Bearer ${sellerToken}`)
          .send({
            orderId: orderId,
            status: "delivered",
            proofOfDelivery: {
              photoURL: "https://example.com/proof123.jpg",
              deliveryNotes: "Delivered successfully",
            },
          });
        return res;
      }, "delivery");
      stepTimings.delivery = deliverResult.duration;

      const flowEndTime = Date.now();
      const totalLatency = flowEndTime - flowStartTime;
      latencies.push(totalLatency);

      resultsCollector.recordOrderProcessingLatency(orderId, totalLatency, stepTimings);
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    console.log(`\nAverage order processing latency over ${orderCount} orders: ${avgLatency.toFixed(2)}ms`);
  }, 180000);
});

