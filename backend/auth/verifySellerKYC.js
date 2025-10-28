const {onCall} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

//admin only callable to set a seller's know your customer verification status in users/{userId}
//verifying user's identity to reduce fraud
//sellers submit id, proof of address, bank account/mobile money details
//seller hierarchy, verified sellers get badges and higher trust
exports.verifySellerKYC = onCall(async (req) => {
  const auth = req.auth;
  if(!auth || auth.token.role !== "admin") { //if not authenticated or role not admin
    throw new Error("unauthorized"); //throw perm denied
  }

  //extract userid, verification status, know your customer data from request data
  const {userId, verificationStatus, kycData} = req.data || {};
  if(!userId || !verificationStatus) {  //if any userId or verification status is missing
    throw new Error("invalid-argument"); //throw invalid arg
  }

  //update users/{userid}
  //set verificationstatus and optional kycdata
  await admin.firestore().collection("users").doc(userId).update({ 
    verificationStatus,
    kycData: kycData || null, 
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true };
});