// scripts/getToken.js
const { initializeApp } = require("firebase/app");
const { getAuth, signInWithEmailAndPassword, connectAuthEmulator } = require("firebase/auth");

// Minimal config for Firebase Emulator
const firebaseConfig = {
  apiKey: "fake-api-key",        // ignored in emulator
  authDomain: "localhost",       // ignored in emulator
  projectId: "demo-project",     // must match emulator projectId
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Connect Auth to emulator
connectAuthEmulator(auth, "http://localhost:9099/");

async function getToken() {
  try {
    // Replace these with your test seller credentials in Auth emulator
    const email = "testseller@example.com";
    const password = "1234567";

    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const idToken = await userCredential.user.getIdToken();
    console.log("ID Token:\n", idToken);
  } catch (err) {
    console.error("Error signing in:", err.message);
  }
}

getToken();
