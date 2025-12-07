const { FieldValue } = require("firebase-admin/firestore");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

/**
 * HELPER FUNCTION: Log order events
 * Creates audit trail for all order-related actions
 */
async function logOrderEvent(orderId, eventType, actorId, metadata = {}) {
  try {
    const logData = {
      orderId,
      eventType,
      actorId,
      metadata,
      timestamp: FieldValue.serverTimestamp(),
    };

    await admin.firestore().collection("orderLogs").add(logData);
  } catch (error) {
    // Log error but don't fail the main operation
    logger.error("Error logging order event:", error);
  }
}

module.exports = { logOrderEvent };

