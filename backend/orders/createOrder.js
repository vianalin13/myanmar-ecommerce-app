const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("../auth"); // Auth function verifying Firebase ID token
const { logOrderEvent } = require("./utils"); // Utility to log order events

// CREATE ORDER
// This endpoint lets a buyer create an order (checkout or chat).
// It validates stock, seller, and payment method, then records
// the transaction as an immutable Firestore document.
exports.createOrder = onRequest(async (request, response) => {
    
  try {
    // Enforce HTTP method (security & clarity)
    if (request.method !== "POST") {
      return response.status(405).json({ error: "Use POST method" });
    }

    // Verify the buyer’s authentication (using Firebase ID token)
    const { uid: buyerId, user: buyerData } = await verifyUser(request);

    // Extract order data from request body
    const {
      sellerId,
      products, // Array of { productId, quantity }
      paymentMethod,
      deliveryAddress,
      chatId, // Optional: link to chat conversation
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
    const validPaymentMethods = ["COD", "KBZPay", "WavePay", "other"];
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

    // CHAT INTEGRATION: Validate chat if chatId is provided
    // This ensures the chat exists and matches the buyer/seller before creating the order
    if (chatId) {
      const chatRef = admin.firestore().collection("chats").doc(chatId);
      const chatDoc = await chatRef.get();

      if (!chatDoc.exists) {
        return response.status(404).json({ error: "Chat not found" });
      }

      const chatData = chatDoc.data();

      // Verify chat belongs to the buyer creating the order
      if (chatData.buyerId !== buyerId) {
        return response.status(403).json({ error: "Unauthorized: chat does not belong to this buyer" });
      }

      // Verify chat belongs to the seller of the order
      if (chatData.sellerId !== sellerId) {
        return response.status(403).json({ error: "Unauthorized: chat does not belong to this seller" });
      }

      // Verify all products belong to the seller in the chat
      // (This is already validated later in the transaction, but we check here for better error messages)
      for (const item of products) {
        const productRef = admin.firestore().collection("products").doc(item.productId);
        const productDoc = await productRef.get();
        if (productDoc.exists) {
          const productData = productDoc.data();
          if (productData.sellerId !== sellerId) {
            return response.status(403).json({
              error: `Product ${item.productId} does not belong to the seller in this chat`,
            });
          }
        }
      }
    }

    // Determine order source (for future analytics)
    const orderSource = chatId ? "chat" : "direct";

    // Use Firestore transaction to atomically:
    // 1. Read products and validate stock
    // 2. Create order
    // 3. Reduce stock
    // This prevents race conditions where two orders could pass stock validation simultaneously
    const firestore = admin.firestore();
    let orderId;
    let totalAmount = 0;
    let validatedProducts = [];

    let transactionErrorMessage = null; // placeholder to capture any transaction errors

    try {
      await firestore.runTransaction(async (transaction) => {
        // Step 1: Read and validate products
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
        if (chatId) {
          const chatRef = firestore.collection("chats").doc(chatId);
          const chatDoc = await transaction.get(chatRef);

          // Verify chat still exists (defensive check within transaction)
          if (!chatDoc.exists) {
            throw new Error("Chat not found during transaction");
          }

          // Prepare chat update data
          const chatUpdateData = {
            orderId: orderId, // Update chat with latest order ID
            updatedAt: FieldValue.serverTimestamp(),
          };

          // Update currentProductId only if order has a single product
          // For multiple products, leave currentProductId unchanged (adjustable for future)
          if (validatedProducts.length === 1) {
            chatUpdateData.currentProductId = validatedProducts[0].productId;
          }
          // Note: For multiple products, we leave currentProductId unchanged
          // This can be adjusted in the future if needed (e.g., set to first product, or null)

          transaction.update(chatRef, chatUpdateData);
        }
      });
    } catch (err) {
      transactionErrorMessage = err.message;
      logger.error("Transaction error:", {
        message: err.message,
        stack: err.stack,
        code: err.code,
      });
    }

    // If transaction failed, handle all known error messages here
    if (transactionErrorMessage) {
      if (transactionErrorMessage.includes("not found")) {
        return response.status(404).json({ error: transactionErrorMessage });
      }
      if (transactionErrorMessage.includes("does not belong")) {
        return response.status(403).json({ error: transactionErrorMessage });
      }
      if (transactionErrorMessage.includes("not available")) {
        return response.status(400).json({ error: transactionErrorMessage });
      }
      if (transactionErrorMessage.includes("Insufficient stock")) {
        return response.status(400).json({ error: transactionErrorMessage });
      }
      if (transactionErrorMessage.includes("Chat not found during transaction")) {
        return response.status(404).json({ error: "Chat not found" });
      }

      // Unknown transaction error (already logged above with full details)
      return response.status(500).json({
        error: "Transaction failed",
        details: transactionErrorMessage,
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

