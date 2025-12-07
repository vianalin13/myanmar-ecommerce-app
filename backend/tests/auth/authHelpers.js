/**
 * AUTHENTICATION HELPERS
 * Shared functions for creating and managing test users with phone number authentication
 */

const admin = require("firebase-admin");
const { firestore } = require("../testSetup");

// Single Firebase app instance for client SDK (reuse to avoid multiple app instances)
let firebaseApp = null;
let firebaseAuth = null;

/**
 * Get or create Firebase app instance (singleton pattern)
 */
function getFirebaseApp() {
  if (!firebaseApp) {
    const { initializeApp } = require("firebase/app");
    const { getAuth, connectAuthEmulator } = require("firebase/auth");

    const firebaseConfig = {
      apiKey: "fake-api-key",
      authDomain: "localhost",
      projectId: "myanmar-ecommerce-prototype",
    };

    firebaseApp = initializeApp(firebaseConfig);
    firebaseAuth = getAuth(firebaseApp);
    connectAuthEmulator(firebaseAuth, "http://localhost:9099/", { disableWarnings: true });
  }
  return { app: firebaseApp, auth: firebaseAuth };
}

// Import signInWithCustomToken (lazy load to avoid issues if not needed)
let signInWithCustomToken = null;
function getSignInWithCustomToken() {
  if (!signInWithCustomToken) {
    const { signInWithCustomToken: signIn } = require("firebase/auth");
    signInWithCustomToken = signIn;
  }
  return signInWithCustomToken;
}

/**
 * Create Auth user and get ID token
 * Uses phone number authentication (Myanmar phone format: +959XXXXXXXXX)
 * 
 * @param {string} uid - Unique user ID
 * @param {string} role - User role: "buyer", "seller", or "admin"
 * @param {string} verificationStatus - Verification status: "verified" or "unverified" (default: "unverified")
 * @returns {Promise<string>} ID token for authentication
 */
async function createAuthUserAndGetToken(uid, role, verificationStatus = "unverified") {
  // Generate unique Myanmar phone number for testing (+959XXXXXXXXX format)
  const randomDigits = Math.floor(Math.random() * 1000000000).toString().padStart(9, "0");
  const phoneNumber = `+959${randomDigits}`;

  try {
    // Create Auth user with phone number (not email)
    await admin.auth().createUser({
      uid: uid,
      phoneNumber: phoneNumber,
      phoneNumberVerified: true, // For testing, mark as verified
    });
  } catch (error) {
    if (error.code !== "auth/uid-already-exists") {
      throw error;
    }
    // User already exists, try to delete and recreate
    try {
      await admin.auth().deleteUser(uid);
      await admin.auth().createUser({
        uid: uid,
        phoneNumber: phoneNumber,
        phoneNumberVerified: true,
      });
    } catch (deleteError) {
      // If delete fails, user might not exist, try creating again
      await admin.auth().createUser({
        uid: uid,
        phoneNumber: phoneNumber,
        phoneNumberVerified: true,
      });
    }
  }

  // Create Firestore user (phone number must match Auth user)
  await firestore.collection("users").doc(uid).set({
    uid: uid,
    phoneNumber: phoneNumber, // Same phone number as Auth user
    role: role,
    verificationStatus: verificationStatus,
    displayName: `Test ${role}`,
    language: "my",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Get ID token using Firebase client SDK with custom token
  // Reuse single Firebase app instance to avoid multiple app instances
  const { auth } = getFirebaseApp();
  const signIn = getSignInWithCustomToken();

  const customToken = await admin.auth().createCustomToken(uid);
  const userCredential = await signIn(auth, customToken);
  const idToken = await userCredential.user.getIdToken();

  return idToken;
}

/**
 * Delete Auth user
 * 
 * @param {string} uid - User ID to delete
 */
async function deleteAuthUser(uid) {
  try {
    await admin.auth().deleteUser(uid);
  } catch (error) {
    // Ignore if user doesn't exist
  }
}

module.exports = {
  createAuthUserAndGetToken,
  deleteAuthUser,
};

