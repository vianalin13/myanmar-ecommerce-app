const {onCall} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

//admin only callable to create another admin user
//caller must be authenticated admin, target user must already exist
exports.createAdmin = onCall(async (req) => {
  const auth = req.auth;
  if(!auth || auth.token.role !== "admin") {
    throw new Error("permission-denied");
  }

  const {userId} = req.data || {};
  if(!userId) {
    throw new Error("invalid-argument");
  }

  await admin.firestore().collection("users").doc(userId).update({
    role: "admin",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true };
})