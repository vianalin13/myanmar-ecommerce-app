/**
 * setup test data for chat testing
 * creates users, products, and generates auth tokens
 * 
 * usage:
 * 1. start firebase emulators: firebase emulators:start
 * 2. run: node scripts/setupTestData.js
 * 3. copy the tokens and use them in tests
 */

const admin = require("firebase-admin");

//initialize firebase admin (connects to emulators automatically)
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "myanmar-ecommerce-prototype",
  });
  
  //connect to emulators
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
}

const db = admin.firestore();
const auth = admin.auth();

async function setupTestData() {
  console.log("=".repeat(60));
  console.log("Setting up test data for chat testing...");
  console.log("=".repeat(60));
  console.log("");

  try {
    //step 1: create buyer user in auth
    console.log("Step 1: Creating buyer user in Auth...");
    let buyer1;
    try {
      buyer1 = await auth.createUser({
        uid: "test-buyer-123",
        phoneNumber: "+959123456789",
        displayName: "Test Buyer",
      });
      console.log("buyer user created:", buyer1.uid);
    } catch (error) {
      if (error.code === "auth/uid-already-exists") {
        console.log("buyer user already exists, using existing user");
        buyer1 = await auth.getUser("test-buyer-123");
      } else {
        throw error;
      }
    }

    //step 2: create sellers user in auth
    console.log("Step 2: Creating seller user in Auth...");
    let seller1;
    try {
      seller1 = await auth.createUser({
        uid: "test-seller-456",
        phoneNumber: "+959987654321",
        displayName: "Test Seller",
      });
      console.log("seller user created:", seller1.uid);
    } catch (error) {
      if (error.code === "auth/uid-already-exists") {
        console.log("seller user already exists, using existing user");
        seller1 = await auth.getUser("test-seller-456");
      } else {
        throw error;
      }
    }

    console.log("Creating second seller user in Auth...");
    let seller2;
    try {
      seller2 = await auth.createUser({
        uid: "test-seller-789",
        phoneNumber: "+959987654322",
        displayName: "Test Seller 2",
      });
      console.log("seller 2 user created:", seller2.uid);
    } catch (error) {
      if (error.code === "auth/uid-already-exists") {
        console.log("seller 2 user already exists, using existing user");
        seller2 = await auth.getUser("test-seller-789");
      } else {
        throw error;
      }
    }


    //step 3: create buyer/seller profiles in firestore
    console.log("Step 3: Creating profiles in Firestore...");

    console.log("Creating buyer profile...");
    await db.collection("users").doc(buyer1.uid).set({
      uid: buyer1.uid,
      phoneNumber: "+959123456789",
      role: "buyer",
      verificationStatus: "verified",
      displayName: "Test Buyer",
      language: "my",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("buyer profile created");

    console.log("Creating seller profile...");
    await db.collection("users").doc(seller1.uid).set({
      uid: seller1.uid,
      phoneNumber: "+959987654321",
      role: "seller",
      verificationStatus: "verified",
      displayName: "Test Seller",
      language: "my",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("seller profile created");

    console.log("Creating second seller profile...");
    await db.collection("users").doc(seller2.uid).set({
      uid: seller2.uid,
      phoneNumber: "+959987654322",
      role: "seller",
      verificationStatus: "verified",
      displayName: "Test Seller 2",
      language: "my",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("seller 2 profile created");

    //step 4: create test products
    console.log("Step 4: Creating test products...");
    
    //product 1 (seller 1)
    const product1 = db.collection("products").doc("test-product-1");
    await product1.set({
      sellerId: seller1.uid,
      name: "Test Product 1",
      description: "A test product from seller 1",
      price: 10000,
      stock: 10,
      category: "Fashion",
      status: "active",
      imageURL: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("product 1 created:", product1.id);

    //product 2 (seller 1)
    const product2 = db.collection("products").doc("test-product-2");
    await product2.set({
      sellerId: seller1.uid,
      name: "Test Product 2",
      description: "Another test product from seller 1",
      price: 15000,
      stock: 5,
      category: "Fashion",
      status: "active",
      imageURL: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("product 2 created:", product2.id);

    //product 3 (seller 2)
    const product3 = db.collection("products").doc("test-product-3");
    await product3.set({
      sellerId: seller2.uid,
      name: "Test Product 3",
      description: "A test product from seller 2",
      price: 20000,
      stock: 8,
      category: "Electronics",
      status: "active",
      imageURL: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("product 3 created:", product3.id);

    console.log("");
    console.log("=".repeat(60));
    console.log("Test data setup complete!");
    console.log("=".repeat(60));
    console.log("");
    console.log("Test Data Summary:");
    console.log("");
    console.log("Buyer:");
    console.log(`  UID: ${buyer1.uid}`);
    console.log(`  Phone: +959123456789`);
    console.log("");
    console.log("Seller 1:");
    console.log(`  UID: ${seller1.uid}`);
    console.log(`  Phone: +959987654321`);
    console.log("");
    console.log("Seller 2:");
    console.log(`  UID: ${seller2.uid}`);
    console.log(`  Phone: +959987654322`);
    console.log("");
    console.log("Products:");
    console.log(`  Product 1 ID: test-product-1 (Seller 1)`);
    console.log(`  Product 2 ID: test-product-2 (Seller 1)`);
    console.log(`  Product 3 ID: test-product-3 (Seller 2)`);
    console.log("");
    console.log("=".repeat(60));
    console.log("");
    console.log("Note: Authentication uses phone number + SMS OTP");
    console.log("   For testing, tests generate ID tokens on-demand using getIdToken()");
    console.log("   Run tests: node backend/tests/chats.test.js");
    console.log("");
    
    return {
      buyerUid: buyer1.uid,
      sellerUid: seller1.uid,
      seller2Uid: seller2.uid,
      product1Id: product1.id,
      product2Id: product2.id,
      product3Id: product3.id,
    };

  } catch (error) {
    console.error("error setting up test data:", error.message);
    console.error(error);
    process.exit(1);
  }
}

//run setup
setupTestData().then(() => {
  console.log("setup complete!");
  process.exit(0);
});

