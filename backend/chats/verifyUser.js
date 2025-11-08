//import firebase admin sfk to verify tokens and read firestore
const admin = require("firebase-admin");

//emulator setup
//connect admin SFK to local emulators when running locally 
//checks if running in emulator setup
if(process.env.FUNCTIONS_EMULATOR) {
  console.log("connecting admin SFK to firebase emulators...");
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080"; //routes firestore
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
}

//generic user verification
//verifies that request has valid firebase ID token
//buyers, sellers, admin
async function verifyUser(request) { //HTTP request with headers/body
  try {
    const authHeader = request.headers.authorization; //extracts authorization header 
    
    if(!authHeader || !authHeader.startsWith("Bearer ")) { //"Bearer abc123xyz" ensures header exists
      throw new Error("missing or invalid authorization header");
    }

    const idToken = authHeader.split("Bearer ")[1]; //splits at Bearer and takes part after it index[1], abc123xyz
    const decodedToken = await admin.auth().verifyIdToken(idToken); //verifies the token (signature, expiration, tampering) and returns decoded token with user info
    const uid = decodedToken.uid; //extracts the user ID from decoded token

    //get user profile from firestore
    const userRef = admin.firestore().collection("users").doc(uid); //builds reference to user doc
    const userDoc = await userRef.get(); //fetches document from firestore

    if(!userDoc.exists) {
      throw new Error("user profile not found");
    }

    const userData = userDoc.data(); //extracts role, phoneNumber, etc...
    return { uid, user: userData };

  } catch(err) {
    console.error("verifyUser error:", err.message);
    throw new Error("authentication failed: " + err.message);
  }
}

module.exports = { verifyUser };