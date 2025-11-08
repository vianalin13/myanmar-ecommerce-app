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

    // Validate products and calculate total cost
    let totalAmount = 0;
    const validatedProducts = [];

    for (const item of products) {
      // Check structure and quantity validity  
      if (!item.productId || !item.quantity || item.quantity <= 0) {
        return response.status(400).json({ error: "Invalid product data: productId and quantity required" });
      }

      // Fetch product data from Firestore
      const productRef = admin.firestore().collection("products").doc(item.productId);
      const productDoc = await productRef.get();

      if (!productDoc.exists) {
        return response.status(404).json({ error: `Product ${item.productId} not found` });
      }

      const productData = productDoc.data();

      // Verify product belongs to seller
      if (productData.sellerId !== sellerId) {
        return response.status(403).json({ error: `Product ${item.productId} does not belong to seller` });
      }

      // Check if product is active or available
      if (productData.status !== "active") {
        return response.status(400).json({ error: `Product ${item.productId} is not available` });
      }

      // Check stock availability (prevent overselling)
      if (productData.stock < item.quantity) {
        return response.status(400).json({ 
          error: `Insufficient stock for ${productData.name}. Available: ${productData.stock}, Requested: ${item.quantity}` 
        });
      }

      // Calculate item total price
      const itemPrice = productData.price;
      const itemTotal = itemPrice * item.quantity;
      totalAmount += itemTotal;

      // Store product snapshot at time of purchase (important for disputes)
      validatedProducts.push({
        productId: item.productId,
        name: productData.name,
        price: itemPrice,
        quantity: item.quantity,
        imageURL: productData.imageURL || null,
      });
    }

    // Determine order source (for future analytics)
    // If chatId is provided, it's from chat; otherwise, it's a direct purchase
    const orderSource = chatId ? "chat" : "direct";

    // Create order data object
    const orderData = {
      buyerId,
      sellerId,
      products: validatedProducts,
      totalAmount,
      paymentMethod,
      paymentStatus: "pending", // COD or mobile money both start as pending
      status: "pending",
      orderSource, // Track whether order came from chat or direct purchase
      chatId: chatId || null, // will be used for chat-linking later
      deliveryAddress: {
        street: deliveryAddress.street,
        city: deliveryAddress.city,
        phone: deliveryAddress.phone,
        notes: deliveryAddress.notes || "",
      },
      paymentConfirmation: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Create order in Firestore
    const orderRef = await admin.firestore().collection("orders").add(orderData);
    const orderId = orderRef.id;
    // Update order with orderId field
    await orderRef.update({ orderId });

    // Reduce stock for each product
    const batch = admin.firestore().batch();
    for (const item of products) {
      const productRef = admin.firestore().collection("products").doc(item.productId);
      batch.update(productRef, {
        stock: FieldValue.increment(-item.quantity),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

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

