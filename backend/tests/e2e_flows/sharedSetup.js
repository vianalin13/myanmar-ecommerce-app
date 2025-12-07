/**
 * SHARED SETUP FOR END-TO-END TESTS
 * reusable setup functions for all E2E test scenarios
 * creates test users (buyer, seller, admin) that can be shared across tests
 */

const { createAuthUserAndGetToken } = require("../helpers/authHelpers");

/**
 * setup test users for E2E tests
 * creates buyer, seller, and admin users with authentication tokens
 * 
 * @returns {Promise<{buyerUid: string, sellerUid: string, adminUid: string, buyerToken: string, sellerToken: string, adminToken: string}>}
 */
async function setupE2EUsers() {
  const timestamp = Date.now();
  const buyerUid = `E2E_BUYER_${timestamp}`;
  const sellerUid = `E2E_SELLER_${timestamp}`;
  const adminUid = `E2E_ADMIN_${timestamp}`;

  //create test users with appropriate roles
  const buyerToken = await createAuthUserAndGetToken(buyerUid, "buyer", "unverified");
  const sellerToken = await createAuthUserAndGetToken(sellerUid, "seller", "verified");
  const adminToken = await createAuthUserAndGetToken(adminUid, "admin", "verified");

  return {
    buyerUid,
    sellerUid,
    adminUid,
    buyerToken,
    sellerToken,
    adminToken,
  };
}

/**
 * cleanup E2E test users
 * 
 * @param {Object} users - user objects with UIDs
 * @param {string} users.buyerUid - buyer user ID
 * @param {string} users.sellerUid - seller user ID
 * @param {string} users.adminUid - admin user ID
 */
async function cleanupE2EUsers(users) {
  const { deleteAuthUser } = require("../helpers/authHelpers");
  const { cleanupTestData } = require("../helpers/cleanupHelpers");

  await cleanupTestData({
    buyerUid: users.buyerUid,
    sellerUid: users.sellerUid,
    productIds: [],
    orderIds: [],
    chatIds: [],
  });

  //note: admin cleanup handled by cleanupTestData if needed
}

module.exports = {
  setupE2EUsers,
  cleanupE2EUsers,
};

