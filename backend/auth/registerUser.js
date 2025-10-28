const {onCall} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

//snap is firestore document snapshot for users/{uid}, read of the profile doc so we can check if it exists
//registering user in firebase phone auth happens when user completes OTP signin on the client
// ^ creates the auth account and gives you a UID

//this callable doesn't create the auth user:
//creates/syncs the user's profile in firestore after auth creates the account
//uses req.auth.uid from alr signed in user to upsert a firestore profile at users/{uid}
//if no doc exists, create a profile with defaults
exports.registerUser = onCall(async (req) => {
  const auth = req.auth; //caller auth context from callable req 
  if(!auth || !auth.uid) {
    throw new Error("unauthenticated");
  }

  const uid = auth.uid; //caller uid
  const phoneNumber = auth?.token?.phone_number ?? null;
  
  //extract role from client (buyer or seller), default to buyer
  const requestedRole = req.data?.role;
  const role = (requestedRole === "seller" || requestedRole === "buyer") ? requestedRole : "buyer";

  const firestore = admin.firestore(); 
  const userRef = firestore.collection("users").doc(uid); //get a reference to users/{uid}
  const snap = await userRef.get(); //read that documentSnapshot
  const now = admin.firestore.FieldValue.serverTimestamp(); //timestamp 

  if(!snap.exists) { //if doc doesn't exist, create with default fields
    await userRef.set({
      uid, 
      phoneNumber,
      role, // use selected role
      verificationStatus: "unverified",
      displayName: "",
      language: "my",
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await userRef.update({updatedAt: now}); //if exists, only bump updatedAt
  }

  return {ok: true}; //success response to client
})