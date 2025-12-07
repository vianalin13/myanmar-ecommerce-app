/**
 * TEST SETUP
 * shared Firebase initialization and constants for all test files
 */

const admin = require("firebase-admin");

//initialize Firebase Admin for emulator (only once)
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "myanmar-ecommerce-prototype",
  });
}

//set emulator environment variables
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
process.env.FUNCTIONS_EMULATOR = "true";

//get Firestore instance
const firestore = admin.firestore();

//base URL for Cloud Functions emulator
const BASE_URL = "http://localhost:5001/myanmar-ecommerce-prototype/us-central1";

module.exports = {
  admin,
  firestore,
  BASE_URL,
};

