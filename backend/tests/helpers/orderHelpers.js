/**
 * ORDER HELPERS
 * Shared functions for creating test orders with different states
 */

const request = require("supertest");
const { firestore, BASE_URL } = require("./testSetup");
const admin = require("firebase-admin");

/**
 * Create test order
 * 
 * @param {Object} options - Order creation options
 * @param {string} options.buyerToken - Buyer authentication token
 * @param {string} options.sellerId - Seller user ID
 * @param {Array} options.products - Array of { productId, quantity }
 * @param {string} options.paymentMethod - Payment method (default: "COD")
 * @param {Object} options.deliveryAddress - Delivery address
 * @param {string} options.chatId - Optional chat ID
 * @returns {Promise<string>} Order ID
 */
async function createTestOrder(options) {
  const {
    buyerToken,
    sellerId,
    products,
    paymentMethod = "COD",
    deliveryAddress = {
      street: "123 Test St",
      city: "Yangon",
      phone: "+959123456789",
      notes: "",
    },
    chatId = undefined,
  } = options;

  const orderData = {
    sellerId,
    products,
    paymentMethod,
    deliveryAddress,
  };

  if (chatId !== undefined) {
    orderData.chatId = chatId;
  }

  const res = await request(BASE_URL)
    .post("/createOrder")
    .set("Authorization", `Bearer ${buyerToken}`)
    .send(orderData);

  if (res.statusCode !== 200) {
    throw new Error(`Failed to create order: ${res.body.error || res.body.details}`);
  }

  return res.body.orderId;
}

/**
 * Create order with specific status
 * 
 * @param {Object} options - Order creation options
 * @param {string} options.buyerToken - Buyer authentication token
 * @param {string} options.sellerToken - Seller authentication token
 * @param {string} options.sellerId - Seller user ID
 * @param {Array} options.products - Array of { productId, quantity }
 * @param {string} options.paymentMethod - Payment method (default: "COD")
 * @param {string} options.status - Target order status: "pending", "confirmed", "shipped", "delivered", "cancelled"
 * @param {Object} options.deliveryAddress - Delivery address (optional)
 * @param {string} options.chatId - Optional chat ID
 * @returns {Promise<string>} Order ID
 */
async function createOrderWithStatus(options) {
  const {
    buyerToken,
    sellerToken,
    sellerId,
    products,
    paymentMethod = "COD",
    status = "pending",
    deliveryAddress = undefined,
    chatId = undefined,
  } = options;

  // Create order
  const orderId = await createTestOrder({
    buyerToken,
    sellerId,
    products,
    paymentMethod,
    deliveryAddress,
    chatId,
  });

  // Update order status if needed
  if (status === "pending") {
    return orderId; // Order is already pending
  }

  if (status === "confirmed") {
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });
    return orderId;
  }

  if (status === "shipped") {
    // First confirm
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    // Then ship
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "shipped",
        trackingNumber: options.trackingNumber || "TRACK123456789",
        trackingProvider: options.trackingProvider || "local_courier",
      });
    return orderId;
  }

  if (status === "delivered") {
    // First confirm and ship
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "confirmed",
      });

    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "shipped",
        trackingNumber: options.trackingNumber || "TRACK123456789",
      });

    // Then deliver
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        orderId: orderId,
        status: "delivered",
        proofOfDelivery: options.proofOfDelivery || {
          otpCode: "123456",
        },
      });
    return orderId;
  }

  if (status === "cancelled") {
    // Cancel order (buyer can cancel pending/confirmed orders)
    await request(BASE_URL)
      .patch("/updateOrderStatus")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        status: "cancelled",
      });
    return orderId;
  }

  return orderId;
}

/**
 * Create delivered and paid order (for escrow release tests)
 * 
 * @param {Object} options - Order creation options
 * @param {string} options.buyerToken - Buyer authentication token
 * @param {string} options.sellerToken - Seller authentication token
 * @param {string} options.sellerId - Seller user ID
 * @param {Array} options.products - Array of { productId, quantity }
 * @param {string} options.paymentMethod - Payment method (default: "KBZPay")
 * @param {boolean} options.autoReleaseEscrow - Whether to allow auto-release (default: true)
 * @returns {Promise<string>} Order ID
 */
async function createDeliveredAndPaidOrder(options) {
  const {
    buyerToken,
    sellerToken,
    sellerId,
    products,
    paymentMethod = "KBZPay",
    autoReleaseEscrow = true,
  } = options;

  // Create order
  const orderId = await createTestOrder({
    buyerToken,
    sellerId,
    products,
    paymentMethod,
  });

  // For non-COD: confirm payment first
  if (paymentMethod !== "COD") {
    await request(BASE_URL)
      .post("/simulatePayment")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({
        orderId: orderId,
        transactionId: "TXN123456",
      });
  }

  // Update order status to delivered
  await request(BASE_URL)
    .patch("/updateOrderStatus")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({
      orderId: orderId,
      status: "confirmed",
    });

  await request(BASE_URL)
    .patch("/updateOrderStatus")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({
      orderId: orderId,
      status: "shipped",
      trackingNumber: "TRACK123456789",
    });

  await request(BASE_URL)
    .patch("/updateOrderStatus")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({
      orderId: orderId,
      status: "delivered",
      proofOfDelivery: {
        otpCode: "123456",
      },
    });

  // If auto-release is disabled, manually set escrowReleased to false
  // This is useful for testing manual escrow release
  if (!autoReleaseEscrow) {
    await firestore.collection("orders").doc(orderId).update({
      escrowReleased: false,
    });
  }

  return orderId;
}

/**
 * Confirm payment for an order
 * 
 * @param {Object} options - Payment options
 * @param {string} options.buyerToken - Buyer authentication token
 * @param {string} options.orderId - Order ID
 * @param {string} options.transactionId - Transaction ID (optional)
 * @param {string} options.receiptId - Receipt ID (optional)
 */
async function confirmPayment(options) {
  const {
    buyerToken,
    orderId,
    transactionId = undefined,
    receiptId = undefined,
  } = options;

  const paymentData = {
    orderId: orderId,
  };

  if (transactionId !== undefined) {
    paymentData.transactionId = transactionId;
  }

  if (receiptId !== undefined) {
    paymentData.receiptId = receiptId;
  }

  const res = await request(BASE_URL)
    .post("/simulatePayment")
    .set("Authorization", `Bearer ${buyerToken}`)
    .send(paymentData);

  if (res.statusCode !== 200) {
    throw new Error(`Failed to confirm payment: ${res.body.error || res.body.details}`);
  }

  return res.body.paymentConfirmation;
}

module.exports = {
  createTestOrder,
  createOrderWithStatus,
  createDeliveredAndPaidOrder,
  confirmPayment,
};

