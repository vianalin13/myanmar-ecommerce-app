const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth"); // Auth function verifying Firebase ID token
const { logOrderEvent } = require("./auditLogger"); // Utility to log order events

/**
 * CREATE ORDER
 * Allows a buyer to create an order (directly or via chat).
 * 
 * Pre-Transaction Validation:
 * - Request validation (method, fields, payment method)
 * - Seller verification (exists, is seller)
 * - Product structure validation
 * 
 * Transaction (Atomic):
 * - Validates chat (if chatId provided)
 * - Validates products (stock, seller, status)
 * - Reduces stock
 * - Creates order document
 * - Updates chat document (if chatId provided)
 * 
 * Post-Transaction:
 * - Logs order creation event
 * - Returns order details to client
 */

exports.createOrder = onRequest(async (request, response) => {
    
  try {
    // Enforce HTTP method (security & clarity)
    if (request.method !== "POST") {
      return response.status(405).json({ error: "Use POST method" });
    }

    // Verify the buyer's authentication (using Firebase ID token)
    const { uid: buyerId } = await verifyUser(request);

    // Extract order data from request body
    const {
      sellerId,
      products, // Array of { productId, quantity }
      paymentMethod,
      deliveryAddress,
      chatId, // link to chat conversation
    } = request.body;

    // Validate required fields
    if (!sellerId || !products || !Array.isArray(products) || products.length === 0) {
      return response.status(400).json({ error: "Missing required fields: sellerId and products" });
    }
    if (!paymentMethod) {
      return response.status(400).json({ error: "Missing payment method" });
    }
    if (!deliveryAddress || !deliveryAddress.street || !deliveryAddress.city || !deliveryAddress.phone) {
      return response.status(400).json({ error: "Missing or invalid delivery address" });
    }

    // Validate payment method
    const validPaymentMethods = ["COD", "KBZPay", "WavePay"];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return response.status(400).json({ error: "Invalid payment method" });
    }

    // Verify seller identity and role
    const sellerRef = admin.firestore().collection("users").doc(sellerId);
    const sellerDoc = await sellerRef.get();
    if (!sellerDoc.exists) {
      return response.status(404).json({ error: "Seller not found" });
    }
    const sellerData = sellerDoc.data();
    if (sellerData.role !== "seller") {
      return response.status(400).json({ error: "User is not a seller" });
    }

    // Validate product structure first (non-critical validation)
    for (const item of products) {
      if (!item.productId || !item.quantity || item.quantity <= 0) {
        return response.status(400).json({ error: "Invalid product data: productId and quantity required" });
      }
    }

    // Determine order source (for future analytics)
    const orderSource = chatId ? "chat" : "direct";

    // Execute atomic transaction to prevent race conditions
    // All operations (chat validation, product validation, stock reduction, order creation, chat update)
    // happen atomically - either all succeed or all fail
    const firestore = admin.firestore();
    let orderId;
    let totalAmount = 0;
    let validatedProducts = [];

    try {
      await firestore.runTransaction(async (transaction) => {
        // CHAT INTEGRATION: Validate chat if chatId is provided (atomic validation)
        // Firestore transactions require all reads before all writes
        let chatDoc = null;
        let chatRef = null;
        if (chatId) {
          chatRef = firestore.collection("chats").doc(chatId);
          chatDoc = await transaction.get(chatRef);
          
          // Verify chat exists
          if (!chatDoc.exists) {
            throw new Error("Chat not found");
          }
          
          // Verify chat matches buyer and seller (atomic validation)
          const chatData = chatDoc.data();
          if (chatData.buyerId !== buyerId) {
            throw new Error("Chat does not belong to this buyer");
          }
          if (chatData.sellerId !== sellerId) {
            throw new Error("Chat does not belong to this seller");
          }
        }

        // Read and validate products
        const productRefs = products.map(item => 
          firestore.collection("products").doc(item.productId)
        );
        const productDocs = await Promise.all(
          productRefs.map(ref => transaction.get(ref))
        );

        validatedProducts = [];
        totalAmount = 0;

        for (let i = 0; i < products.length; i++) {
          const item = products[i];
          const productDoc = productDocs[i];

          if (!productDoc.exists) {
            throw new Error(`Product ${item.productId} not found`);
          }
          const productData = productDoc.data();

          // Validate product belongs to seller (atomic validation)
          if (productData.sellerId !== sellerId) {
            throw new Error(`Product ${item.productId} does not belong to seller`);
          }

          if (productData.status !== "active") {
            throw new Error(`Product ${item.productId} is not available`);
          }

          if (productData.stock < item.quantity) {
            throw new Error(
              `Insufficient stock for ${productData.name}. Available: ${productData.stock}, Requested: ${item.quantity}`
            );
          }

          const itemTotal = productData.price * item.quantity;
          totalAmount += itemTotal;

          validatedProducts.push({
            productId: item.productId,
            name: productData.name,
            price: productData.price,
            quantity: item.quantity,
            imageURL: productData.imageURL || null,
          });

          transaction.update(productRefs[i], {
            stock: FieldValue.increment(-item.quantity),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        // Create order document atomically
        const orderRef = firestore.collection("orders").doc();
        orderId = orderRef.id;
        const orderData = {
          buyerId,
          sellerId,
          products: validatedProducts,
          totalAmount,
          paymentMethod,
          paymentStatus: "pending",
          status: "pending",
          orderSource,
          chatId: chatId || null,
          deliveryAddress: {
            street: deliveryAddress.street,
            city: deliveryAddress.city,
            phone: deliveryAddress.phone,
            notes: deliveryAddress.notes || "",
          },
          paymentConfirmation: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          orderId,
        };
        transaction.set(orderRef, orderData);

        // CHAT INTEGRATION: Update chat document with orderId (atomic with order creation)
        // This links the order to the chat bidirectionally
        if (chatId && chatRef && chatDoc) {
          const chatUpdateData = {
            orderId: orderId,
            updatedAt: FieldValue.serverTimestamp(),
          };

          // Update currentProductId only if order has a single product
          if (validatedProducts.length === 1) {
            chatUpdateData.currentProductId = validatedProducts[0].productId;
          }
          // Note: For multiple products, we leave currentProductId unchanged
          // This can be adjusted in the future if needed (e.g., set to first product, or null)

          transaction.update(chatRef, chatUpdateData);
        }
      });
    } catch (err) {
      // Handle transaction errors with appropriate status codes
      logger.error("Transaction error:", {
        message: err.message,
        stack: err.stack,
        code: err.code,
      });

      // Map error messages to appropriate HTTP status codes
      if (err.message.includes("not found")) {
        return response.status(404).json({ error: err.message });
      }
      if (err.message.includes("does not belong")) {
        return response.status(403).json({ error: err.message });
      }
      if (err.message.includes("not available") || err.message.includes("Insufficient stock")) {
        return response.status(400).json({ error: err.message });
      }

      // Generic transaction error
      return response.status(500).json({
        error: "Transaction failed",
        details: err.message,
      });
    }
  
    // Log order creation event
    await logOrderEvent(orderId, "order_created", buyerId, {
      sellerId,
      totalAmount,
      paymentMethod,
      productCount: products.length,
      orderSource,
      chatId: chatId || null,
    });

    // Respond to client
    if (chatId) {
      logger.info(`Order created from chat: ${orderId} by buyer ${buyerId} from seller ${sellerId} (chatId: ${chatId})`);
    } else {
      logger.info(`Order created: ${orderId} by buyer ${buyerId} from seller ${sellerId}`);
    }
    return response.json({
      success: true,
      message: "Order created successfully",
      orderId,
      totalAmount,
    });
  } catch (error) {
    // Catch-all error handling
    logger.error("Error creating order:", error);
    return response.status(500).json({
      error: "Failed to create order",
      details: error.message,
    });
  }
});

