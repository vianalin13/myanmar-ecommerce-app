//start chat
//creates/retrieves an existing chat between buyer and seller

const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("./verifyUser");

exports.startChat = onRequest(async (request, response) => {
  try {
    if(request.method !== "POST") {
      return response.status(405).json({
        error: "use POST method"
      });
    }

    //verify user is authenticated
    const { uid: userId } = await verifyUser(request);
    const { productId, sellerId } = request.body;

    //either productId OR sellerId must be provided
    //if productId provided, we get sellerId from product
    //if sellerId provided directly, we use it (for starting chat without product)
    let finalSellerId = sellerId;

    if (productId) {
      //get product to find the seller
      const productRef = admin.firestore().collection("products").doc(productId);
      const productDoc = await productRef.get();

      if(!productDoc.exists) {
        return response.status(404).json({
          error: "product not found"
        });
      }

      const productData = productDoc.data();
      finalSellerId = productData.sellerId;
    }

    if (!finalSellerId) {
      return response.status(400).json({ 
        error: "must provide either productId or sellerId" 
      });
    }

    //user cannot chat with themselves
    if (userId === finalSellerId) {
      return response.status(400).json({ 
        error: "you cannot start a chat with yourself" 
      });
    }

    //the requester is the buyer
    const buyerId = userId;

    //check if chat already exists for this buyer-seller
    const existingChatsSnapshot = await admin
      .firestore()
      .collection("chats")
      .where("buyerId", "==", buyerId)
      .where("sellerId", "==", finalSellerId)
      .limit(1)
      .get();

    let chatId;
    let chatData;

    if(!existingChatsSnapshot.empty) {
      //return existing chat
      const existingChatDoc = existingChatsSnapshot.docs[0];
      chatId = existingChatDoc.id;
      chatData = existingChatDoc.data();
      
      //if productId was provided and different from current productId,
      //we could optionally update a "currentProductId" field
      //but the main chat stays the same
      
      logger.info(`returning existing chat: ${chatId} for buyer ${buyerId} and seller ${finalSellerId}`);
    
    } else {
      //create new chat
      const chatRef = admin.firestore().collection("chats").doc();
      chatId = chatRef.id;

      chatData = {
        chatId,
        buyerId,
        sellerId: finalSellerId,
        initialProductId: productId || null, //reference to product that started the chat
        currentProductId: productId || null, //current product being discussed (can change)
        orderId: null, //will be set when order is created
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastMessageAt: null,
        lastMessage: null,
      };

      await chatRef.set(chatData);

      //log chat creation
      await logEvent(userId, "chat_created", {
        chatId,
        sellerId: finalSellerId,
        productId: productId || null,
      });

      logger.info(`new chat created: ${chatId} for buyer ${buyerId} and seller ${finalSellerId}`);
    }

    return response.json({
      success: true,
      chatId,
      chat: chatData,
    });

  } catch(error) {
    logger.error("error starting chat:", error);
    return response.status(500).json({
      error: "failed to start chat",
      details: error.message,
    });
  }
});

//helper to log events
async function logEvent(userId, action, metadata = {}) {
  try {
    const logRef = admin.firestore().collection("logs").doc();
    await logRef.set({
      logId: logRef.id,
      userId,
      action,
      metadata,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch(error) {
    logger.error("error logging event:", error);
  }
}
