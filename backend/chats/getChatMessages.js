//get chat messages
//retrieves messages for a chat
//supports optional filtering by productId
//supports pagination with limit

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("./verifyUser");

exports.getChatMessages = onRequest(async (request, response) => {
  try {
    if(request.method !== "GET") {
      return response.status(405).json({
        error: "use GET method"
      });
    }

    //verify user is authenticated
    const { uid: userId } = await verifyUser(request);
    
    //get query parameters
    const { chatId, productId, limit } = request.query;

    //validate required fields
    if (!chatId) {
      return response.status(400).json({
        error: "chatId is required"
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

    //build query for messages
    let messagesQuery = admin
      .firestore()
      .collection("messages")
      .where("chatId", "==", chatId)
      .orderBy("timestamp", "asc"); //oldest first

    //optionally filter by productId
    if (productId) {
      messagesQuery = messagesQuery.where("productId", "==", productId);
    }

    //apply limit if provided (default to 50, max 100)
    const limitNum = limit ? Math.min(parseInt(limit, 10), 100) : 50;
    messagesQuery = messagesQuery.limit(limitNum);

    //execute query
    const messagesSnapshot = await messagesQuery.get();

    //format messages
    const messages = messagesSnapshot.docs.map(doc => {
      const messageData = doc.data();
      return {
        messageId: doc.id,
        ...messageData,
        //convert timestamp to readable format if needed
        timestamp: messageData.timestamp ? messageData.timestamp.toMillis() : null,
      };
    });

    logger.info(`retrieved ${messages.length} messages for chat ${chatId}`);

    return response.json({
      success: true,
      chatId,
      productId: productId || null,
      messageCount: messages.length,
      messages,
    });

  } catch(error) {
    logger.error("error getting chat messages:", error);
    return response.status(500).json({
      error: "failed to get chat messages",
      details: error.message,
    });
  }
});

