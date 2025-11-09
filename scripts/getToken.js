// scripts/getToken.js
// Helper script to get ID token for testing (uses phone number authentication)
const admin = require("firebase-admin");
const { initializeApp } = require("firebase/app");
const { getAuth, signInWithCustomToken, connectAuthEmulator } = require("firebase/auth");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "myanmar-ecommerce-prototype",
  });
}

// Set emulator host
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";

// Minimal config for Firebase Emulator
const firebaseConfig = {
  apiKey: "fake-api-key",        // ignored in emulator
  authDomain: "localhost",       // ignored in emulator
  projectId: "myanmar-ecommerce-prototype", // must match emulator projectId
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Connect Auth to emulator
connectAuthEmulator(auth, "http://localhost:9099/", { disableWarnings: true });

async function getToken(uid) {
  try {
    if (!uid) {
      console.error("Usage: node getToken.js <uid>");
      console.error("Example: node getToken.js testSeller123");
      process.exit(1);
    }

    // Create custom token for the user (user must exist in Auth)
    const customToken = await admin.auth().createCustomToken(uid);
    
    // Sign in with custom token to get ID token
    const userCredential = await signInWithCustomToken(auth, customToken);
    const idToken = await userCredential.user.getIdToken();
    
    console.log("ID Token:\n", idToken);
    console.log("\nUser UID:", uid);
    console.log("User Phone:", userCredential.user.phoneNumber || "N/A");
  } catch (err) {
    console.error("Error getting token:", err.message);
    console.error("\nMake sure:");
    console.error("1. Firebase Auth emulator is running");
    console.error("2. User with UID exists in Auth emulator");
    console.error("3. User was created with phone number (not email)");
    process.exit(1);
  }
}

// Get UID from command line argument
const uid = process.argv[2];
getToken(uid);
