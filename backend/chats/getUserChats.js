//get user chats
//retrieves all chats for a user (as buyer or seller)
//returns chats sorted by lastMessageAt (most recent first)

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const { verifyUser } = require("./verifyUser");

exports.getUserChats = onRequest(async (request, response) => {
  try {
    if(request.method !== "GET") {
      return response.status(405).json({
        error: "use GET method"
      });
    }

    //verify user is authenticated and get user role
    const { uid: userId, user: userData } = await verifyUser(request);
    const userRole = userData.role; // "buyer" or "seller"
    
    //get query parameters
    const { limit } = request.query;

    //build query based on user's role
    //users can only be buyer OR seller, so we query based on their role
    let chatsQuery;
    
    if (userRole === "buyer") {
      //user is a buyer, get chats where they are the buyer
      chatsQuery = admin
        .firestore()
        .collection("chats")
        .where("buyerId", "==", userId);
    } else if (userRole === "seller") {
      //user is a seller, get chats where they are the seller
      chatsQuery = admin
        .firestore()
        .collection("chats")
        .where("sellerId", "==", userId);
    } else {
      //user role is invalid or not set
      return response.status(400).json({
        error: "user role is invalid or not set"
      });
    }

    //order by lastMessageAt (descending - most recent first)
    try {
      chatsQuery = chatsQuery.orderBy("lastMessageAt", "desc");
    } catch (error) {
      //if index doesn't exist, we'll sort in memory
      logger.warn("could not order by lastMessageAt, will sort in memory");
    }

    //apply limit (default 50, max 100)
    const limitNum = limit ? Math.min(parseInt(limit, 10), 100) : 50;
    chatsQuery = chatsQuery.limit(limitNum * 2); //get more to account for sorting

    //execute query
    const chatsSnapshot = await chatsQuery.get();

    //format and sort chats
    let chats = chatsSnapshot.docs.map(doc => {
      const chatData = doc.data();
      return {
        chatId: doc.id,
        buyerId: chatData.buyerId,
        sellerId: chatData.sellerId,
        initialProductId: chatData.initialProductId || null,
        currentProductId: chatData.currentProductId || null,
        orderId: chatData.orderId || null,
        lastMessageAt: chatData.lastMessageAt 
          ? (chatData.lastMessageAt.toMillis ? chatData.lastMessageAt.toMillis() : chatData.lastMessageAt)
          : null,
        lastMessage: chatData.lastMessage || null,
        createdAt: chatData.createdAt 
          ? (chatData.createdAt.toMillis ? chatData.createdAt.toMillis() : chatData.createdAt)
          : null,
        updatedAt: chatData.updatedAt 
          ? (chatData.updatedAt.toMillis ? chatData.updatedAt.toMillis() : chatData.updatedAt)
          : null,
        //user's role in this chat (same as their account role)
        userRole: userRole,
        //get other party's info
        otherPartyId: userRole === "buyer" ? chatData.sellerId : chatData.buyerId,
      };
    });

    //sort by lastMessageAt (most recent first), then by createdAt if no lastMessage
    chats.sort((a, b) => {
      const aTime = a.lastMessageAt || a.createdAt || 0;
      const bTime = b.lastMessageAt || b.createdAt || 0;
      return bTime - aTime; //descending (newest first)
    });

    //apply final limit
    chats = chats.slice(0, limitNum);

    logger.info(`retrieved ${chats.length} chats for user ${userId} (${userRole})`);

    return response.json({
      success: true,
      userId,
      userRole,
      chatCount: chats.length,
      chats,
    });

  } catch(error) {
    logger.error("error getting user chats:", error);
    return response.status(500).json({
      error: "failed to get user chats",
      details: error.message,
    });
  }
});

