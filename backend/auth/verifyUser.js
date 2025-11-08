const admin = require("firebase-admin");

// Connect admin SDK to local emulators when running locally
if (process.env.FUNCTIONS_EMULATOR) {
  console.log("Connecting admin SDK to Firebase emulators...");
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080"; // Firestore emulator
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099"; // Auth emulator
}

// Verifies Firebase ID token from HTTP request and ensures user exists in Firestore.
// This is a general authentication function for buyers and other authenticated operations.
async function verifyUser(request) {
  try {
    // Extract Authorization header from the HTTP request
    // It should be in the format: "Authorization: Bearer <ID_TOKEN>"
    const authHeader = request.headers.authorization;

    // Validate the Authorization header
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Missing or invalid Authorization header");
    }

    // Extract ID token from the header
    const idToken = authHeader.split("Bearer ")[1];

    // Verify the ID token using Firebase Admin SDK
    // This decodes the token and validates it with Firebase Auth
    const decodedToken = await admin.auth().verifyIdToken(idToken);

    // Extract the UID (unique user ID) from the decoded token
    const uid = decodedToken.uid;

    // Retrieve the user profile from Firestore using the UID
    // Assuming we have a "users" collection where each doc ID = UID
    const userRef = admin.firestore().collection("users").doc(uid);
    const userDoc = await userRef.get();

    // Check if the user document exists in Firestore
    if (!userDoc.exists) {
      throw new Error("User profile not found");
    }

    // Get the user data object from Firestore document
    const userData = userDoc.data();

    // If all checks pass, return the UID and the user profile data
    return { uid, user: userData };
  } catch (err) {
    console.error("verifyUser error:", err.message);
    throw new Error("Authentication failed: " + err.message);
  }
}

module.exports = { verifyUser };

