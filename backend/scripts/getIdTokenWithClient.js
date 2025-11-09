/**
 * get ID Token using Firebase Client SDK (for emulator testing)
 * this script uses Firebase client SDK to exchange custom token for ID token
 * 
 * usage:
 * 1. start Firebase emulators: firebase emulators:start
 * 2. run: node scripts/getIdTokenWithClient.js <uid>
 *    example: node scripts/getIdTokenWithClient.js test-buyer-123
 */

const admin = require("firebase-admin");
const { initializeApp } = require("firebase/app");
const { getAuth, signInWithCustomToken, connectAuthEmulator } = require("firebase/auth");

//initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "myanmar-ecommerce-prototype",
  });
  
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
}

//initialize Firebase Client
const firebaseConfig = {
  apiKey: "fake-api-key",
  authDomain: "localhost",
  projectId: "myanmar-ecommerce-prototype",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

//connect to emulator
connectAuthEmulator(auth, "http://localhost:9099/", { disableWarnings: true });

async function getIdToken(uid) {
  try {
    console.log("=".repeat(60));
    console.log("Getting ID Token for Testing");
    console.log("=".repeat(60));
    console.log("");
    console.log(`UID: ${uid}`);
    console.log("");

    //create custom token
    console.log("creating custom token...");
    const customToken = await admin.auth().createCustomToken(uid);
    console.log("custom token created");
    console.log("");

    //exchange custom token for ID token
    console.log("exchanging custom token for ID token...");
    const userCredential = await signInWithCustomToken(auth, customToken);
    const idToken = await userCredential.user.getIdToken();
    console.log("ID token obtained");
    console.log("");

    console.log("=".repeat(60));
    console.log("ID Token:");
    console.log("=".repeat(60));
    console.log(idToken);
    console.log("=".repeat(60));
    console.log("");

    return idToken;
  } catch (error) {
    console.error("error:", error.message);
    if (error.code === "auth/user-not-found") {
      console.error("user not found. please run setupTestData.js first");
    }
    process.exit(1);
  }
}

//get UID from command line or use default
const uid = process.argv[2] || "test-buyer-123";

getIdToken(uid).then(() => {
  process.exit(0);
});

