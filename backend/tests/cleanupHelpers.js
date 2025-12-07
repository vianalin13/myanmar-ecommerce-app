/**
 * CLEANUP HELPERS
 * Shared functions for cleaning up test data (orders, products, users, logs)
 */

const { firestore } = require("./testSetup");
const { deleteAuthUser } = require("./auth/authHelpers");

/**
 * Delete Firestore document
 * 
 * @param {string} collection - Collection name
 * @param {string} docId - Document ID
 */
async function deleteFirestoreDoc(collection, docId) {
  try {
    await firestore.collection(collection).doc(docId).delete();
  } catch (error) {
    // Ignore if document doesn't exist
  }
}

/**
 * Cleanup order logs (batch deletion for efficiency)
 * 
 * @param {string[]} orderIds - Array of order IDs
 */
async function cleanupOrderLogs(orderIds) {
  if (!orderIds || orderIds.length === 0) {
    return;
  }

  // Filter out undefined/null values
  const validOrderIds = orderIds.filter(id => id != null);

  if (validOrderIds.length === 0) {
    return;
  }

  // Delete order logs in batches of 10 (Firestore "in" query limit)
  for (let i = 0; i < validOrderIds.length; i += 10) {
    const batch = validOrderIds.slice(i, i + 10);
    const logsSnapshot = await firestore.collection("orderLogs")
      .where("orderId", "in", batch)
      .get();
    
    if (logsSnapshot.docs.length > 0) {
      const deleteBatch = firestore.batch();
      logsSnapshot.docs.forEach(doc => deleteBatch.delete(doc.ref));
      await deleteBatch.commit();
    }
  }
}

/**
 * Cleanup orders
 * 
 * @param {string[]} orderIds - Array of order IDs
 */
async function cleanupOrders(orderIds) {
  if (!orderIds || orderIds.length === 0) {
    return;
  }

  for (const orderId of orderIds) {
    await deleteFirestoreDoc("orders", orderId);
  }
}

/**
 * Cleanup products
 * 
 * @param {string[]} productIds - Array of product IDs
 */
async function cleanupProducts(productIds) {
  if (!productIds || productIds.length === 0) {
    return;
  }

  for (const productId of productIds) {
    await deleteFirestoreDoc("products", productId);
  }
}

/**
 * Cleanup chats
 * 
 * @param {string[]} chatIds - Array of chat IDs
 */
async function cleanupChats(chatIds) {
  if (!chatIds || chatIds.length === 0) {
    return;
  }

  for (const chatId of chatIds) {
    await deleteFirestoreDoc("chats", chatId);
  }
}

/**
 * Cleanup users (Firestore and Auth)
 * 
 * @param {string[]} userIds - Array of user IDs
 */
async function cleanupUsers(userIds) {
  if (!userIds || userIds.length === 0) {
    return;
  }

  // Delete Firestore users
  for (const userId of userIds) {
    if (userId) {
      await deleteFirestoreDoc("users", userId);
      await deleteAuthUser(userId);
    }
  }
}

/**
 * Cleanup all test data
 * Unified cleanup function that handles orders, logs, products, chats, and users
 * 
 * @param {Object} options - Cleanup options
 * @param {string} options.buyerUid - Buyer user ID (optional)
 * @param {string} options.sellerUid - Seller user ID (optional)
 * @param {string} options.adminUid - Admin user ID (optional)
 * @param {string[]} options.productIds - Array of product IDs (optional)
 * @param {string[]} options.orderIds - Array of order IDs (optional)
 * @param {string[]} options.chatIds - Array of chat IDs (optional)
 */
async function cleanupTestData(options = {}) {
  const {
    buyerUid = null,
    sellerUid = null,
    adminUid = null,
    productIds = [],
    orderIds = [],
    chatIds = [],
  } = options;

  // Cleanup order logs first (before orders)
  if (orderIds && orderIds.length > 0) {
    await cleanupOrderLogs(orderIds);
  }

  // Cleanup orders
  if (orderIds && orderIds.length > 0) {
    await cleanupOrders(orderIds);
  }

  // Cleanup chats
  if (chatIds && chatIds.length > 0) {
    await cleanupChats(chatIds);
  }

  // Cleanup products
  if (productIds && productIds.length > 0) {
    await cleanupProducts(productIds);
  }

  // Cleanup users (Firestore and Auth)
  const userIds = [buyerUid, sellerUid, adminUid].filter(uid => uid !== null);
  if (userIds.length > 0) {
    await cleanupUsers(userIds);
  }
}

module.exports = {
  deleteFirestoreDoc,
  cleanupOrderLogs,
  cleanupOrders,
  cleanupProducts,
  cleanupChats,
  cleanupUsers,
  cleanupTestData,
};

