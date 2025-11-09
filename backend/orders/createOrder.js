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
    logger.info(`Order created: ${orderId} by buyer ${buyerId} from seller ${sellerId}`);
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

