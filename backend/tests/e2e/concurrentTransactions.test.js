/**
 * END-TO-END TEST: CONCURRENT TRANSACTION HANDLING
 * tests fraud prevention mechanisms under concurrent load
 * verifies: stock doesn't oversell (atomic transactions work)
 * 
 * test scenarios:
 * - multiple buyers ordering same product concurrently (stock protection)
 * - concurrent orders with different quantities
 * - double payment prevention
 * 
 * E2E flow test because it validates complete fraud prevention
 *
 */

const request = require("supertest");
const { firestore, BASE_URL } = require("../testSetup");
const { createAuthUserAndGetToken } = require("../auth/authHelpers");
const { cleanupTestData } = require("../cleanupHelpers");
const { createTestProduct } = require("../products/productHelpers");
const { createTestChat } = require("../chat/chatHelpers");
const { measureTime } = require("./timingHelpers");
const resultsCollector = require("./resultsCollector");

describe("End-to-End: Concurrent Transaction Handling (Fraud Prevention)", () => {
  let sellerUid;
  let sellerToken;
  let productId;
  let productIds = [];
  let buyerUsers = [];
  let orderIds = [];
  let chatIds = [];

  beforeEach(async () => {
    const timestamp = Date.now();
    sellerUid = `CONCURRENT_SELLER_${timestamp}`;
    sellerToken = await createAuthUserAndGetToken(sellerUid, "seller", "verified");

    //create product with limited stock
    productId = await createTestProduct(sellerToken, {
      name: "Concurrent Test Product",
      price: 10000,
      stock: 3, // Only 3 items available
      category: "Test",
    });
    productIds.push(productId);
  }, 30000);

  afterEach(async () => {
    //cleanup all buyer users
    await Promise.all(
      buyerUsers.map(user =>
        cleanupTestData({
          buyerUid: user.uid,
          orderIds: user.orderIds || [],
          chatIds: user.chatIds || [],
        })
      )
    );

    await cleanupTestData({
      sellerUid,
      productIds,
      orderIds,
      chatIds,
    });

    buyerUsers = [];
    productIds = [];
    orderIds = [];
    chatIds = [];
  }, 60000);

  test("Multiple buyers ordering same product concurrently (stock protection)", async () => {
    const concurrentBuyerCount = 5; //5 buyers, but only 3 items in stock
    const buyers = [];

    //create buyer users
    for (let i = 0; i < concurrentBuyerCount; i++) {
      const timestamp = Date.now();
      const buyerUid = `CONCURRENT_BUYER_${timestamp}_${i}`;
      const buyerToken = await createAuthUserAndGetToken(buyerUid, "buyer", "unverified");
      const chatId = await createTestChat(buyerUid, sellerUid, productId);
      chatIds.push(chatId);

      buyers.push({
        uid: buyerUid,
        token: buyerToken,
        chatId: chatId,
        orderIds: [],
      });
    }

    buyerUsers = buyers;

    //get initial stock
    const initialProduct = await firestore.collection("products").doc(productId).get();
    const initialStock = initialProduct.data().stock;
    console.log(`Initial stock: ${initialStock}`);

    const startTime = Date.now();

    //all buyers try to order simultaneously
    const orderPromises = buyers.map(async (buyer, index) => {
      try {
        const result = await measureTime(async () => {
          const res = await request(BASE_URL)
            .post("/createOrder")
            .set("Authorization", `Bearer ${buyer.token}`)
            .send({
              sellerId: sellerUid,
              products: [{ productId: productId, quantity: 1 }],
              chatId: buyer.chatId,
              paymentMethod: "COD",
              deliveryAddress: {
                street: `Test Address ${index}`,
                city: "Yangon",
                phone: "+959123456789",
              },
            });
          return res;
        }, `createOrder_buyer_${index}`);

        if (result.result && result.result.statusCode === 200) {
          const orderId = result.result.body.orderId;
          buyer.orderIds.push(orderId);
          orderIds.push(orderId);
          resultsCollector.recordApiTiming("createOrder", result.duration, true, "e2e");
          return { success: true, buyerIndex: index, orderId, result };
        } else {
          const errorMsg = result.result?.body?.error || result.result?.body?.details || result.result?.body?.message || "Unknown error";
          console.error(`Order creation failed for buyer ${index}:`, errorMsg, "Status:", result.result?.statusCode);
          resultsCollector.recordApiTiming("createOrder", result.duration, false, "e2e");
          return { success: false, buyerIndex: index, error: errorMsg };
        }
      } catch (error) {
        return { success: false, buyerIndex: index, error: error.message };
      }
    });

    const results = await Promise.all(orderPromises);
    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    //check final stock
    const finalProduct = await firestore.collection("products").doc(productId).get();
    const finalStock = finalProduct.data().stock;

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log("\n=== Concurrent Order Test Results ===");
    console.log(`Concurrent buyers: ${concurrentBuyerCount}`);
    console.log(`Initial stock: ${initialStock}`);
    console.log(`Final stock: ${finalStock}`);
    console.log(`Successful orders: ${successCount}`);
    console.log(`Failed orders: ${failureCount}`);
    console.log(`Total duration: ${totalDuration}ms`);

    //verify stock consistency
    const expectedStock = initialStock - successCount;
    expect(finalStock).toBe(expectedStock);
    expect(successCount).toBeLessThanOrEqual(initialStock);
    expect(finalStock).toBeGreaterThanOrEqual(0);

    //record as E2E flow
    const flowSteps = [];
    const securityCheckpoints = [];
    
    //collect all order attempts as flow steps
    //each result has a 'result' property which is the measureTime result with duration
    results.forEach((r, index) => {
      //r.result is the measureTime result: { result, duration, operationName }
      const duration = r.result?.duration || 0;
      flowSteps.push({
        operation: `createOrder_buyer_${index}`,
        duration: duration,
      });
    });
    
    if (failureCount > 0) {
      securityCheckpoints.push("overselling_prevention");
      resultsCollector.recordFraudPrevention(
        "overselling_prevention",
        true,
        `Blocked ${failureCount} orders to prevent overselling`
      );
    }
    
    securityCheckpoints.push("atomic_transaction_validation");
    resultsCollector.recordSecurityCheckpoint("atomic_transaction_validation", productId);

    //record complete flow
    resultsCollector.recordFlow({
      scenarioName: "Prevent Overselling with Concurrent Orders (5 Buyers)",
      flowType: "fraud_prevention",
      totalDuration,
      steps: flowSteps,
      apiCallCount: concurrentBuyerCount,
      securityCheckpointsHit: securityCheckpoints.length,
      success: true, //flow succeeded in preventing overselling
    });

    //also record concurrent test result for metrics
    resultsCollector.recordConcurrentTest({
      userCount: concurrentBuyerCount,
      successCount,
      failureCount,
      averageDuration: totalDuration / concurrentBuyerCount,
      testType: "concurrent_order_creation",
      throughput: parseFloat((successCount / (totalDuration / 1000)).toFixed(2)),
    });
  }, 120000);

  test("Prevent overselling with concurrent orders (different quantities)", async () => {
    const buyers = [];
    const quantities = [1, 2, 1]; //total: 4, but stock is 3

    for (let i = 0; i < quantities.length; i++) {
      const timestamp = Date.now();
      const buyerUid = `QTY_BUYER_${timestamp}_${i}`;
      const buyerToken = await createAuthUserAndGetToken(buyerUid, "buyer", "unverified");
      const chatId = await createTestChat(buyerUid, sellerUid, productId);
      chatIds.push(chatId);

      buyers.push({
        uid: buyerUid,
        token: buyerToken,
        chatId: chatId,
        quantity: quantities[i],
        orderIds: [],
      });
    }

    buyerUsers = buyers;

    const initialProduct = await firestore.collection("products").doc(productId).get();
    const initialStock = initialProduct.data().stock;

    //all buyers try to order simultaneously with different quantities
    const orderPromises = buyers.map(async (buyer, index) => {
      try {
        const result = await measureTime(async () => {
          const res = await request(BASE_URL)
            .post("/createOrder")
            .set("Authorization", `Bearer ${buyer.token}`)
            .send({
              sellerId: sellerUid,
              products: [{ productId: productId, quantity: buyer.quantity }],
              chatId: buyer.chatId,
              paymentMethod: "COD",
              deliveryAddress: {
                street: `Test Address ${index}`,
                city: "Yangon",
                phone: "+959123456789",
              },
            });
          return res;
        }, `createOrder_qty_${buyer.quantity}`);

        if (result.result && result.result.statusCode === 200) {
          const orderId = result.result.body.orderId;
          buyer.orderIds.push(orderId);
          orderIds.push(orderId);
          return { success: true, quantity: buyer.quantity };
        } else {
          return { success: false, quantity: buyer.quantity, error: result.result?.body?.error };
        }
      } catch (error) {
        return { success: false, quantity: buyer.quantity, error: error.message };
      }
    });

    const results = await Promise.all(orderPromises);

    const finalProduct = await firestore.collection("products").doc(productId).get();
    const finalStock = finalProduct.data().stock;

    const successCount = results.filter(r => r.success).length;
    const totalOrderedQuantity = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + buyers.find(b => b.quantity === r.quantity)?.quantity || 0, 0);

    console.log("\n=== Concurrent Order with Different Quantities ===");
    console.log(`Initial stock: ${initialStock}`);
    console.log(`Final stock: ${finalStock}`);
    console.log(`Successful orders: ${successCount}`);
    console.log(`Total quantity ordered: ${totalOrderedQuantity}`);

    //verify stock consistency
    const expectedStock = initialStock - totalOrderedQuantity;
    expect(finalStock).toBe(expectedStock);
    expect(totalOrderedQuantity).toBeLessThanOrEqual(initialStock);

    //record as E2E flow
    const flowSteps = results.map(r => r.result || { operationName: "createOrder", duration: 0 });
    const securityCheckpoints = ["atomic_transaction_validation"];
    resultsCollector.recordSecurityCheckpoint("atomic_transaction_validation", productId);
    
    resultsCollector.recordFlow({
      scenarioName: "Prevent Overselling with Concurrent Orders (Different Quantities)",
      flowType: "fraud_prevention",
      totalDuration: 0, //not tracking total duration for this test
      steps: flowSteps.map(step => ({
        operation: step.operationName || "createOrder",
        duration: step.duration || 0,
      })),
      apiCallCount: buyers.length,
      securityCheckpointsHit: securityCheckpoints.length,
      success: true,
    });
  }, 120000);

  test("Concurrent payment simulation (prevent double payment)", async () => {
    const buyerUid = `PAYMENT_BUYER_${Date.now()}`;
    const buyerToken = await createAuthUserAndGetToken(buyerUid, "buyer", "unverified");
    const chatId = await createTestChat(buyerUid, sellerUid, productId);
    chatIds.push(chatId);

    buyerUsers.push({ uid: buyerUid, orderIds: [], chatIds: [chatId] });

    //create order
    const orderRes = await request(BASE_URL)
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

    if (orderRes.statusCode !== 200) {
      throw new Error(`Failed to create order: ${orderRes.body.error || JSON.stringify(orderRes.body)}`);
    }

    const orderId = orderRes.body.orderId;
    orderIds.push(orderId);

    //try to pay twice simultaneously
    const paymentPromises = [1, 2].map(async (attempt) => {
      try {
        const result = await measureTime(async () => {
          const res = await request(BASE_URL)
            .post("/simulatePayment")
            .set("Authorization", `Bearer ${buyerToken}`)
            .send({
              orderId: orderId,
              paymentMethod: "kbzpay",
              transactionId: `TXN_${Date.now()}_${attempt}`,
            });
          return res;
        }, `simulatePayment_attempt_${attempt}`);

        if (result.result && result.result.statusCode === 200) {
          return { success: true, attempt };
        } else {
          const errorMsg = result.result?.body?.error || result.result?.body?.details || result.result?.body?.message || "Unknown error";
          console.error(`Payment attempt ${attempt} failed:`, errorMsg, "Status:", result.result?.statusCode);
          return { success: false, attempt, error: errorMsg };
        }
      } catch (error) {
        return { success: false, attempt, error: error.message };
      }
    });

    const results = await Promise.all(paymentPromises);

    const successCount = results.filter(r => r.success).length;

    console.log("\n=== Concurrent Payment Test ===");
    console.log(`Payment attempts: 2`);
    console.log(`Successful payments: ${successCount}`);

    //only one payment should succeed
    expect(successCount).toBe(1);

    //record as E2E flow
    const flowSteps = [];
    const securityCheckpoints = [];
    
    //collect flow steps from payment attempts
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      flowSteps.push({
        operation: `simulatePayment_attempt_${result.attempt}`,
        duration: 0, // Duration not tracked in this test
      });
    }
    
    if (successCount === 1) {
      securityCheckpoints.push("double_payment_prevention");
      resultsCollector.recordFraudPrevention(
        "double_payment_prevention",
        true,
        "Prevented duplicate payment for same order"
      );
      resultsCollector.recordSecurityCheckpoint("double_payment_prevention", orderId);
    }

    //record complete flow
    resultsCollector.recordFlow({
      scenarioName: "Prevent Double Payment with Concurrent Payment Attempts",
      flowType: "fraud_prevention",
      totalDuration: 0, // Not tracking total duration for this test
      steps: flowSteps,
      apiCallCount: 2, // Two payment attempts
      securityCheckpointsHit: securityCheckpoints.length,
      success: true,
    });
  }, 120000);
});

