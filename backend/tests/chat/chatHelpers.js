/**
 * CHAT HELPERS
 * Shared functions for creating test chats
 */

const { firestore, admin } = require("../testSetup");
const { FieldValue } = require("firebase-admin/firestore");

/**
 * Create a test chat between buyer and seller
 * 
 * @param {string} buyerId - Buyer user ID
 * @param {string} sellerId - Seller user ID
 * @param {string} [productId] - Optional product ID (for initialProductId and currentProductId)
 * @returns {Promise<string>} Chat ID
 */
async function createTestChat(buyerId, sellerId, productId = null) {
  const chatRef = firestore.collection("chats").doc();
  const chatId = chatRef.id;

  const chatData = {
    chatId,
    buyerId,
    sellerId,
    initialProductId: productId || null,
    currentProductId: productId || null,
    orderId: null,
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastMessageAt: null,
    lastMessage: null,
  };

  await chatRef.set(chatData);
  return chatId;
}

module.exports = {
  createTestChat,
};

