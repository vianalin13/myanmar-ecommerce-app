/**
 * CREATE ORDER TEST SUITE
 * Tests the createOrder function with proper isolation and cleanup
 * 
 * Features:
 * - Phone number authentication (Myanmar format)
 * - Test isolation (beforeEach/afterEach)
 * - Complete cleanup to prevent repeated run failures
 * - Tests all validation scenarios
 */

const request = require("supertest");
const { firestore, BASE_URL } = require("./helpers/testSetup");
const { createAuthUserAndGetToken } = require("./helpers/authHelpers");
const { cleanupTestData } = require("./helpers/cleanupHelpers");
const { createTestProduct } = require("./helpers/productHelpers");
const { createTestChat } = require("./helpers/chatHelpers");

// ============================================================================
// CREATE ORDER TESTS
// ============================================================================

describe("Create Order API Tests", () => {
  let buyerUid;
  let sellerUid;
  let buyerToken;
  let sellerToken;
  let productId1;
  let productId2;
  let productIds = [];
  let orderIds = [];
  let chatIds = [];

  // Setup before each test (isolation)
  beforeEach(async () => {
    const timestamp = Date.now();
    buyerUid = `TEST_BUYER_${timestamp}`;
    sellerUid = `TEST_SELLER_${timestamp}`;

    // Create buyer and seller with phone number auth
    buyerToken = await createAuthUserAndGetToken(buyerUid, "buyer", "unverified");
    sellerToken = await createAuthUserAndGetToken(sellerUid, "seller", "verified");

    // Create test products for order tests using shared helper
    productId1 = await createTestProduct(sellerToken, {
      name: "Test Product 1",
      price: 10000,
      stock: 100,
      category: "Test",
    });
    productIds.push(productId1);

    productId2 = await createTestProduct(sellerToken, {
      name: "Test Product 2",
      price: 20000,
      stock: 50,
      category: "Test",
    });
    productIds.push(productId2);
  }, 30000); // Increase timeout for setup

  // Cleanup after each test
  afterEach(async () => {
    await cleanupTestData({
      buyerUid,
      sellerUid,
      productIds,
      orderIds,
      chatIds,
    });
    orderIds = [];
    productIds = [];
    chatIds = [];
  }, 30000); // Increase timeout for cleanup

  // ========================================================================
  // SUCCESS CASES
  // ========================================================================

  test("Create order (valid - single product)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 2 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
          notes: "Test notes",
        },
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBeDefined();
    expect(res.body.totalAmount).toBe(20000); // 2 * 10000

    orderIds.push(res.body.orderId);

    // Verify order was created in Firestore
    const orderDoc = await firestore.collection("orders").doc(res.body.orderId).get();
    expect(orderDoc.exists).toBe(true);
    const orderData = orderDoc.data();
    expect(orderData.buyerId).toBe(buyerUid);
    expect(orderData.sellerId).toBe(sellerUid);
    expect(orderData.status).toBe("pending");
    expect(orderData.paymentStatus).toBe("pending");
    expect(orderData.paymentMethod).toBe("COD");
    expect(orderData.orderSource).toBe("direct");
    expect(orderData.chatId).toBeNull();
    expect(orderData.products).toHaveLength(1);
    expect(orderData.products[0].productId).toBe(productId1);
    expect(orderData.products[0].quantity).toBe(2);
    expect(orderData.totalAmount).toBe(20000);

    // Verify stock was reduced
    const productDoc = await firestore.collection("products").doc(productId1).get();
    expect(productDoc.data().stock).toBe(98); // 100 - 2
  }, 30000);

  test("Create order (valid - multiple products)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [
          { productId: productId1, quantity: 3 },
          { productId: productId2, quantity: 2 },
        ],
        paymentMethod: "KBZPay",
        deliveryAddress: {
          street: "456 Test Ave",
          city: "Mandalay",
          phone: "+959987654321",
        },
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBeDefined();
    expect(res.body.totalAmount).toBe(70000); // (3 * 10000) + (2 * 20000)

    orderIds.push(res.body.orderId);

    // Verify order data
    const orderDoc = await firestore.collection("orders").doc(res.body.orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.products).toHaveLength(2);
    expect(orderData.totalAmount).toBe(70000);
    expect(orderData.paymentMethod).toBe("KBZPay");

    // Verify stock was reduced for both products
    const product1Doc = await firestore.collection("products").doc(productId1).get();
    const product2Doc = await firestore.collection("products").doc(productId2).get();
    expect(product1Doc.data().stock).toBe(97); // 100 - 3
    expect(product2Doc.data().stock).toBe(48); // 50 - 2
  }, 30000);

  // ========================================================================
  // CHAT INTEGRATION TESTS
  // ========================================================================

  test("Create order (with valid chatId - single product)", async () => {
    // Create a test chat between buyer and seller
    const chatId = await createTestChat(buyerUid, sellerUid, productId1);
    chatIds.push(chatId);

    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "WavePay",
        deliveryAddress: {
          street: "789 Chat St",
          city: "Yangon",
          phone: "+959111222333",
        },
        chatId: chatId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBeDefined();
    orderIds.push(res.body.orderId);

    // Verify order source is "chat" when chatId is provided
    const orderDoc = await firestore.collection("orders").doc(res.body.orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.orderSource).toBe("chat");
    expect(orderData.chatId).toBe(chatId);

    // Verify chat document is updated with orderId
    const updatedChatDoc = await firestore.collection("chats").doc(chatId).get();
    const updatedChatData = updatedChatDoc.data();
    expect(updatedChatData.orderId).toBe(res.body.orderId);

    // Verify currentProductId is updated for single product order
    expect(updatedChatData.currentProductId).toBe(productId1);
  }, 30000);

  test("Create order (with valid chatId - multiple products)", async () => {
    // Create a test chat between buyer and seller (no initial product)
    const chatId = await createTestChat(buyerUid, sellerUid);
    chatIds.push(chatId);

    // Set initial currentProductId to productId1
    await firestore.collection("chats").doc(chatId).update({
      currentProductId: productId1,
    });

    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [
          { productId: productId1, quantity: 2 },
          { productId: productId2, quantity: 1 },
        ],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "456 Chat St",
          city: "Yangon",
          phone: "+959111222333",
        },
        chatId: chatId,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBeDefined();
    orderIds.push(res.body.orderId);

    // Verify order source is "chat"
    const orderDoc = await firestore.collection("orders").doc(res.body.orderId).get();
    const orderData = orderDoc.data();
    expect(orderData.orderSource).toBe("chat");
    expect(orderData.chatId).toBe(chatId);

    // Verify chat document is updated with orderId
    const updatedChatDoc2 = await firestore.collection("chats").doc(chatId).get();
    const updatedChatData2 = updatedChatDoc2.data();
    expect(updatedChatData2.orderId).toBe(res.body.orderId);

    // Verify currentProductId is unchanged for multiple product order
    // (should still be productId1, not updated)
    expect(updatedChatData2.currentProductId).toBe(productId1);
  }, 30000);

  test("Create order (with invalid chatId - should fail)", async () => {
    const invalidChatId = "non-existent-chat-id";

    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
        chatId: invalidChatId,
      });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Chat not found/i);
  }, 30000);

  test("Create order (with chatId - wrong buyer - should fail)", async () => {
    // Create another buyer
    const timestamp = Date.now();
    const otherBuyerUid = `TEST_OTHER_BUYER_${timestamp}`;
    const otherBuyerToken = await createAuthUserAndGetToken(otherBuyerUid, "buyer", "unverified");

    // Create a chat between the original buyer and seller
    const chatId = await createTestChat(buyerUid, sellerUid, productId1);
    chatIds.push(chatId);

    // Try to create order with other buyer (should fail)
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${otherBuyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
        chatId: chatId,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Chat does not belong to this buyer/i);

    // Cleanup other buyer
    await cleanupTestData({
      buyerUid: otherBuyerUid,
    });
  }, 30000);

  test("Create order (with chatId - wrong seller - should fail)", async () => {
    // Create another seller
    const timestamp = Date.now();
    const otherSellerUid = `TEST_OTHER_SELLER_${timestamp}`;
    const otherSellerToken = await createAuthUserAndGetToken(otherSellerUid, "seller", "verified");

    // Create a chat between buyer and original seller
    const chatId = await createTestChat(buyerUid, sellerUid, productId1);
    chatIds.push(chatId);

    // Create a product for the other seller
    const otherProductId = await createTestProduct(otherSellerToken, {
      name: "Other Seller Product",
      price: 15000,
      stock: 50,
      category: "Test",
    });

    // Try to create order with other seller (should fail)
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: otherSellerUid,
        products: [{ productId: otherProductId, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
        chatId: chatId,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Chat does not belong to this seller/i);

    // Cleanup other seller and product
    await cleanupTestData({
      sellerUid: otherSellerUid,
      productIds: [otherProductId],
    });
  }, 30000);

  test("Create order (with chatId - product from different seller - should fail)", async () => {
    // Create another seller and their product
    const timestamp = Date.now();
    const otherSellerUid = `TEST_OTHER_SELLER_${timestamp}`;
    const otherSellerToken = await createAuthUserAndGetToken(otherSellerUid, "seller", "verified");
    const otherProductId = await createTestProduct(otherSellerToken, {
      name: "Other Seller Product",
      price: 15000,
      stock: 50,
      category: "Test",
    });

    // Create a chat between buyer and original seller
    const chatId = await createTestChat(buyerUid, sellerUid, productId1);
    chatIds.push(chatId);

    // Try to create order with product from other seller (should fail)
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid, // Correct seller
        products: [{ productId: otherProductId, quantity: 1 }], // But product from other seller
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
        chatId: chatId,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/does not belong to seller/);

    // Cleanup other seller and product
    await cleanupTestData({
      sellerUid: otherSellerUid,
      productIds: [otherProductId],
    });
  }, 30000);

  test("Create order (WavePay payment method)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "WavePay",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    orderIds.push(res.body.orderId);

    const orderDoc = await firestore.collection("orders").doc(res.body.orderId).get();
    expect(orderDoc.data().paymentMethod).toBe("WavePay");
  }, 30000);


  // ========================================================================
  // VALIDATION ERROR CASES
  // ========================================================================

  test("Create order (missing sellerId)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  });

  test("Create order (missing products)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  });

  test("Create order (empty products array)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  });

  test("Create order (missing payment method)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing payment method/);
  });

  test("Create order (invalid payment method)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "InvalidMethod",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid payment method/);
  });

  test("Create order (missing delivery address)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing or invalid delivery address/);
  });

  test("Create order (missing street in delivery address)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing or invalid delivery address/);
  });

  test("Create order (missing city in delivery address)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing or invalid delivery address/);
  });

  test("Create order (missing phone in delivery address)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Missing or invalid delivery address/);
  });

  test("Create order (invalid product data - missing productId)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid product data/);
  });

  test("Create order (invalid product data - missing quantity)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid product data/);
  });

  test("Create order (invalid product data - quantity <= 0)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 0 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid product data/);
  });

  test("Create order (invalid product data - negative quantity)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: -1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid product data/);
  });

  // ========================================================================
  // BUSINESS LOGIC ERROR CASES
  // ========================================================================

  test("Create order (insufficient stock)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1000 }], // More than available (100)
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Insufficient stock/);

    // Verify stock was NOT reduced (transaction should have failed)
    const productDoc = await firestore.collection("products").doc(productId1).get();
    expect(productDoc.data().stock).toBe(100); // Stock should remain unchanged
  }, 30000);

  test("Create order (product not found)", async () => {
    const fakeProductId = "fakeProductId123";
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: fakeProductId, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  test("Create order (seller not found)", async () => {
    const fakeSellerId = "fakeSellerId123";
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: fakeSellerId,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/Seller not found/);
  });

  test("Create order (product belongs to different seller)", async () => {
    // Create another seller and product
    const otherSellerUid = `TEST_OTHER_SELLER_${Date.now()}`;
    const otherSellerToken = await createAuthUserAndGetToken(otherSellerUid, "seller", "verified");

    const otherProductId = await createTestProduct(otherSellerToken, {
      name: "Other Seller Product",
      price: 5000,
      stock: 10,
      category: "Test",
    });

    // Try to create order with other seller's product but wrong sellerId
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid, // Wrong seller
        products: [{ productId: otherProductId, quantity: 1 }], // Other seller's product
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/does not belong to seller/);

    // Cleanup
    await cleanupTestData({
      sellerUid: otherSellerUid,
      productIds: [otherProductId],
    });
  }, 30000);

  test("Create order (product not active)", async () => {
    // Create a product using shared helper
    const inactiveProductId = await createTestProduct(sellerToken, {
      name: "Inactive Product",
      price: 5000,
      stock: 10,
      category: "Test",
    });
    productIds.push(inactiveProductId);

    // Deactivate the product using updateProduct (set status to "inactive")
    await request(BASE_URL)
      .patch("/updateProduct")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        productId: inactiveProductId,
        status: "inactive",
      });

    // Try to create order with inactive product
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: inactiveProductId, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/not available/);
  }, 30000);

  test("Create order (user is not a seller)", async () => {
    // Create a buyer user (not a seller)
    const buyerSellerUid = `TEST_BUYER_SELLER_${Date.now()}`;
    const buyerSellerToken = await createAuthUserAndGetToken(buyerSellerUid, "buyer", "unverified");

    // Try to create order with buyer as seller
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: buyerSellerUid, // Buyer, not seller
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/User is not a seller/);

    // Cleanup
    await cleanupTestData({
      buyerUid: buyerSellerUid,
    });
  }, 30000);

  // ========================================================================
  // AUTHENTICATION ERROR CASES
  // ========================================================================

  test("Create order (no auth token)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error, caught by catch-all
    expect(res.body.error).toBeDefined();
  });

  test("Create order (invalid auth token)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", "Bearer invalidToken123")
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(500); // verifyUser throws error, caught by catch-all
    expect(res.body.error).toBeDefined();
  });

  // ========================================================================
  // HTTP METHOD ERROR CASES
  // ========================================================================

  test("Create order (wrong HTTP method - GET)", async () => {
    const res = await request(BASE_URL)
      .get("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use POST method/);
  });

  test("Create order (wrong HTTP method - PATCH)", async () => {
    const res = await request(BASE_URL)
      .patch("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use POST method/);
  });

  test("Create order (wrong HTTP method - DELETE)", async () => {
    const res = await request(BASE_URL)
      .delete("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(res.statusCode).toBe(405);
    expect(res.body.error).toMatch(/Use POST method/);
  });

  // ========================================================================
  // EDGE CASES
  // ========================================================================

  test("Create order (delivery notes optional)", async () => {
    const res = await request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: productId1, quantity: 1 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
          // notes is optional
        },
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    orderIds.push(res.body.orderId);

    // Verify notes field exists (should be empty string if not provided)
    const orderDoc = await firestore.collection("orders").doc(res.body.orderId).get();
    expect(orderDoc.data().deliveryAddress.notes).toBe("");
  }, 30000);

  test("Create order (concurrent orders - stock race condition prevention)", async () => {
    // Create two orders simultaneously for the same product with limited stock
    // Firestore transactions ensure only one order succeeds (prevents overselling)
    const limitedStockProductId = await createTestProduct(sellerToken, {
      name: "Limited Stock Product",
      price: 5000,
      stock: 5, // Only 5 in stock
      category: "Test",
    });
    productIds.push(limitedStockProductId);

    // Create two orders simultaneously (both request more than available stock)
    // Order 1: requests 4 units
    // Order 2: requests 3 units
    // Total requested: 7 units, but only 5 available
    // With transactions, exactly one should succeed
    const order1Promise = request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: limitedStockProductId, quantity: 4 }],
        paymentMethod: "COD",
        deliveryAddress: {
          street: "123 Test St",
          city: "Yangon",
          phone: "+959123456789",
        },
      });

    // Create second order immediately (concurrent)
    const order2Promise = request(BASE_URL)
      .post("/createOrder")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        sellerId: sellerUid,
        products: [{ productId: limitedStockProductId, quantity: 3 }], // 4 + 3 = 7 > 5 (stock)
        paymentMethod: "COD",
        deliveryAddress: {
          street: "456 Test Ave",
          city: "Yangon",
          phone: "+959987654321",
        },
      });

    const [order1Res, order2Res] = await Promise.all([order1Promise, order2Promise]);

    // With Firestore transactions, exactly one order should succeed and one should fail
    // We can't guarantee which one succeeds first due to concurrency, so we check both
    const successCount = [order1Res, order2Res].filter(res => res.statusCode === 200).length;
    const failCount = [order1Res, order2Res].filter(res => res.statusCode === 400).length;

    // Exactly one order should succeed
    expect(successCount).toBe(1);
    // Exactly one order should fail
    expect(failCount).toBe(1);

    // Track which order succeeded and which failed
    const successOrder = order1Res.statusCode === 200 ? order1Res : order2Res;
    const failOrder = order1Res.statusCode === 400 ? order1Res : order2Res;

    // Verify successful order
    expect(successOrder.body.success).toBe(true);
    expect(successOrder.body.orderId).toBeDefined();
    if (successOrder.body.orderId) {
      orderIds.push(successOrder.body.orderId);
    }

    // Verify failed order
    expect(failOrder.body.error).toMatch(/Insufficient stock/);

    // Verify stock is correct based on which order succeeded
    const productDoc = await firestore.collection("products").doc(limitedStockProductId).get();
    const finalStock = productDoc.data().stock;
    
    // Stock should be reduced by the quantity of the successful order
    // If 4-unit order succeeded: stock = 5 - 4 = 1
    // If 3-unit order succeeded: stock = 5 - 3 = 2
    if (successOrder.body.totalAmount === 20000) {
      // 4-unit order succeeded (4 * 5000 = 20000)
      expect(finalStock).toBe(1);
    } else if (successOrder.body.totalAmount === 15000) {
      // 3-unit order succeeded (3 * 5000 = 15000)
      expect(finalStock).toBe(2);
    } else {
      // Fallback: just verify stock is valid (not negative, not original value)
      expect(finalStock).toBeGreaterThanOrEqual(0);
      expect(finalStock).toBeLessThan(5);
    }
  }, 30000);
});

