//sends a message in an existing chat
//supports text messages and images (imageURL)
//optional productId to associate message with a product

const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("./verifyUser");

exports.sendMessage = onRequest(async (request, response) => {
  try {
    if(request.method !== "POST") {
      return response.status(405).json({
        error: "use POST method"
      });
    }

    //verify user is authenticated
    const { uid: userId, user: userData } = await verifyUser(request);
    const { chatId, text, imageURL, productId } = request.body;

    //validate required fields
    if (!chatId) {
      return response.status(400).json({
        error: "chatId is required"
      });
    }

    //must have either text or imageURL
    if (!text && !imageURL) {
      return response.status(400).json({
        error: "must provide either text or imageURL"
      });
    }

    //cannot have both text and imageURL (for now - could support captions later)
    if (text && imageURL) {
      return response.status(400).json({
        error: "provide either text or imageURL, not both"
      });
    }

    //get chat to verify it exists and user is part of it
    const chatRef = admin.firestore().collection("chats").doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) {
      return response.status(404).json({
        error: "chat not found"
      });
    }

    const chatData = chatDoc.data();

    //verify user is either buyer or seller in this chat
    if (userId !== chatData.buyerId && userId !== chatData.sellerId) {
      return response.status(403).json({
        error: "you are not part of this chat"
      });
    }

    //determine sender role
    const senderRole = userId === chatData.buyerId ? "buyer" : "seller";

    //validate productId if provided
    if (productId) {
      const productRef = admin.firestore().collection("products").doc(productId);
      const productDoc = await productRef.get();
      
      if (!productDoc.exists) {
        return response.status(404).json({
          error: "product not found"
        });
      }

      //verify product belongs to the seller in this chat
      const productData = productDoc.data();
      if (productData.sellerId !== chatData.sellerId) {
        return response.status(400).json({
          error: "product does not belong to seller in this chat"
        });
      }
    }

    //determine message type
    const messageType = imageURL ? "image" : "text";

    //create message document
    const messageRef = admin.firestore().collection("messages").doc();
    const messageId = messageRef.id;

    const messageData = {
      messageId,
      chatId,
      senderId: userId,
      senderRole,
      messageType,
      text: text || null,
      imageURL: imageURL || null,
      productId: productId || null,
      orderId: null, //will be set when order is created
      timestamp: FieldValue.serverTimestamp(),
      read: false,
    };

    await messageRef.set(messageData);

    //update chat document with last message info
    await chatRef.update({
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessage: text || "[Image]",
      updatedAt: FieldValue.serverTimestamp(),
      //optionally update currentProductId if productId provided
      ...(productId && { currentProductId: productId }),
    });

    //log message sent event
    await logEvent(userId, "message_sent", {
      chatId,
      messageId,
      messageType,
      productId: productId || null,
    });

    logger.info(`message sent: ${messageId} in chat ${chatId} by ${senderRole} ${userId}`);

    return response.json({
      success: true,
      messageId,
      message: messageData,
    });

  } catch(error) {
    logger.error("error sending message:", error);
    return response.status(500).json({
      error: "failed to send message",
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

