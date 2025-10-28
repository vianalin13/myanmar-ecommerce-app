const {onCall} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

exports.updateUserProfile = onCall(async (req) => {
  const auth = req.auth;
  if(!auth || !auth.uid) {
    throw new Error("unauthenticated");
  }

  const {displayName, language} = req.data || {};
  const updates = {};
  if(typeof displayName === "string") updates.displayName = displayName.slice(0, 80);
  if(typeof language === "string") updates.language = language;

  if(Object.keys(updates).length === 0) {
    return { ok: true };
  }

  updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  
  await admin.firestore().collection("users").doc(auth.uid).update(updates);
  return { ok: true };
});