const admin = require("firebase-admin");

//initialize with project ID for emulator
admin.initializeApp({
  projectId: "myanmar-ecommerce-prototype"
});

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

const firestore = admin.firestore();

async function testRegisterUser() {
  const testUid = "TEST_UID_" + Date.now();
  const userRef = firestore.collection("users").doc(testUid);

  await userRef.set({
    uid: testUid,
    phoneNumber: "+959123456789",
    role: "buyer",
    verificationStatus: "unverified",
    displayName: "",
    language: "my", 
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log("user doc created:", testUid);
  return testUid;
}

async function testUpdateUserProfile(uid) {
  const userRef = firestore.collection("users").doc(uid);
  
  await userRef.update({
    displayName: "michelle",
    language: "en",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log("user profile updated:", uid);
}

async function testVerifySellerKYC(uid) {
  const userRef = firestore.collection("users").doc(uid);

  //simulate admin action, verify seller's KYC
  await userRef.update({
    verificationStatus: "verified",
    kycData: { 
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "approved"
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log("seller KYC verified:", uid);
}

async function testCreateAdmin(uid) {
  const userRef = firestore.collection("users").doc(uid);
  
  await userRef.update({
    role: "admin",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log("user promoted to admin:", uid);
}

async function runTests() {
  try {
    console.log("=".repeat(60));
    console.log("AUTH SYSTEM TESTS");
    console.log("=".repeat(60));
    
    //test 1: register new user
    console.log("\nTEST 1: Register New User");
    const uid = await testRegisterUser();
    
    //test 2: update user profile
    console.log("\nTEST 2: Update User Profile");
    await testUpdateUserProfile(uid);
    
    //test 3: register seller and verify KYC
    console.log("\nTEST 3: Register Seller and Verify KYC");
    const sellerUid = await testRegisterUser();
    await testVerifySellerKYC(sellerUid);
    
    //test 4: create admin (promote existing user)
    console.log("\nTEST 4: Promote User to Admin");
    const adminTargetUid = await testRegisterUser();
    await testCreateAdmin(adminTargetUid);
    
    console.log("\n" + "=".repeat(60));
    console.log("ALL TESTS PASSED");
    console.log("=".repeat(60));
    console.log("Check emulator UI -> Firestore -> users collection");
    console.log("Created users:");
    console.log(`  - Regular user: ${uid}`);
    console.log(`  - Verified seller: ${sellerUid}`);
    console.log(`  - Admin user: ${adminTargetUid}`);
  } catch (err) {
    console.error("\n❌ Test failed:", err.message);
    console.error(err.stack);
  }
  process.exit(0);
}

runTests();