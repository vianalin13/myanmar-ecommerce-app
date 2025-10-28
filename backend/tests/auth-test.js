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
    //const uid = await testRegisterUser();
    //await testUpdateUserProfile("TEST_UID_1761677483264");

    //const sellerUid = await testRegisterUser();
    //await testVerifySellerKYC("TEST_UID_1761677592126");

    //const adminTargetUid = await testRegisterUser();
    await testCreateAdmin("TEST_UID_1761678866541"
);
    
    console.log("all tests passed");
    console.log("check emulator UI -> firestore -> users");
  } catch (err) {
    console.error("test failed:", err.message);
  }
  process.exit(0);
}

runTests();