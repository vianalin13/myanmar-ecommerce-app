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
    let buyerUser;
    try {
      buyerUser = await auth.createUser({
        uid: "test-buyer-123",
        email: "testbuyer@example.com",
        password: "test123456",
        displayName: "Test Buyer",
        phoneNumber: "+959123456789",
      });
      console.log("buyer user created:", buyerUser.uid);
    } catch (error) {
      if (error.code === "auth/uid-already-exists") {
        console.log("buyer user already exists, using existing user");
        buyerUser = await auth.getUser("test-buyer-123");
      } else {
        throw error;
      }
    }

    //step 2: create seller user in auth
    console.log("Step 2: Creating seller user in Auth...");
    let sellerUser;
    try {
      sellerUser = await auth.createUser({
        uid: "test-seller-456",
        email: "testseller@example.com",
        password: "test123456",
        displayName: "Test Seller",
        phoneNumber: "+959987654321",
      });
      console.log("seller user created:", sellerUser.uid);
    } catch (error) {
      if (error.code === "auth/uid-already-exists") {
        console.log("seller user already exists, using existing user");
        sellerUser = await auth.getUser("test-seller-456");
      } else {
        throw error;
      }
    }

    //step 2b: create second seller user in auth
    console.log("Step 2b: Creating second seller user in Auth...");
    let seller2User;
    try {
      seller2User = await auth.createUser({
        uid: "test-seller-789",
        email: "testseller2@example.com",
        password: "test123456",
        displayName: "Test Seller 2",
        phoneNumber: "+959987654322",
      });
      console.log("seller 2 user created:", seller2User.uid);
    } catch (error) {
      if (error.code === "auth/uid-already-exists") {
        console.log("seller 2 user already exists, using existing user");
        seller2User = await auth.getUser("test-seller-789");
      } else {
        throw error;
      }
    }

    //step 3: create buyer profile in firestore
    console.log("Step 3: Creating buyer profile in Firestore...");
    await db.collection("users").doc(buyerUser.uid).set({
      uid: buyerUser.uid,
      phoneNumber: "+959123456789",
      role: "buyer",
      verificationStatus: "verified",
      displayName: "Test Buyer",
      language: "my",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("buyer profile created");

    //step 4: create seller profile in firestore
    console.log("Step 4: Creating seller profile in Firestore...");
    await db.collection("users").doc(sellerUser.uid).set({
      uid: sellerUser.uid,
      phoneNumber: "+959987654321",
      role: "seller",
      verificationStatus: "verified",
      displayName: "Test Seller",
      language: "my",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("seller profile created");

    //step 4b: create second seller profile in firestore
    console.log("Step 4b: Creating second seller profile in Firestore...");
    await db.collection("users").doc(seller2User.uid).set({
      uid: seller2User.uid,
      phoneNumber: "+959987654322",
      role: "seller",
      verificationStatus: "verified",
      displayName: "Test Seller 2",
      language: "my",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("seller 2 profile created");

    //step 5: create test products
    console.log("Step 5: Creating test products...");
    
    //product 1
    const product1Ref = db.collection("products").doc("test-product-1");
    await product1Ref.set({
      sellerId: sellerUser.uid,
      name: "Test Product 1",
      description: "A test product for chat testing",
      price: 10000,
      stock: 10,
      category: "Fashion",
      status: "active",
      imageURL: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("product 1 created:", product1Ref.id);

    //product 2 (same seller)
    const product2Ref = db.collection("products").doc("test-product-2");
    await product2Ref.set({
      sellerId: sellerUser.uid,
      name: "Test Product 2",
      description: "Another test product from same seller",
      price: 15000,
      stock: 5,
      category: "Fashion",
      status: "active",
      imageURL: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("product 2 created:", product2Ref.id);

    //product 3 (second seller)
    const product3Ref = db.collection("products").doc("test-product-3");
    await product3Ref.set({
      sellerId: seller2User.uid,
      name: "Test Product 3",
      description: "A test product from second seller",
      price: 20000,
      stock: 8,
      category: "Electronics",
      status: "active",
      imageURL: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log("product 3 created:", product3Ref.id);

    //step 6: generate custom tokens and exchange for ID tokens
    console.log("Step 6: Generating auth tokens...");
    
    //create custom token for buyer
    const buyerCustomToken = await auth.createCustomToken(buyerUser.uid);
    console.log("buyer custom token created");
    
    //create custom token for seller
    const sellerCustomToken = await auth.createCustomToken(sellerUser.uid);
    console.log("seller custom token created");

    console.log("");
    console.log("=".repeat(60));
    console.log("Test data setup complete!");
    console.log("=".repeat(60));
    console.log("");
    console.log("Test Data Summary:");
    console.log("");
    console.log("Buyer:");
    console.log(`  UID: ${buyerUser.uid}`);
    console.log(`  Email: testbuyer@example.com`);
    console.log(`  Password: test123456`);
    console.log("");
    console.log("Seller 1:");
    console.log(`  UID: ${sellerUser.uid}`);
    console.log(`  Email: testseller@example.com`);
    console.log(`  Password: test123456`);
    console.log("");
    console.log("Seller 2:");
    console.log(`  UID: ${seller2User.uid}`);
    console.log(`  Email: testseller2@example.com`);
    console.log(`  Password: test123456`);
    console.log("");
    console.log("Products:");
    console.log(`  Product 1 ID: test-product-1 (Seller 1)`);
    console.log(`  Product 2 ID: test-product-2 (Seller 1)`);
    console.log(`  Product 3 ID: test-product-3 (Seller 2)`);
    console.log("");
    console.log("=".repeat(60));
    console.log("");
    console.log("Note: Custom tokens need to be exchanged for ID tokens");
    console.log("   Use the getAuthToken.js script to get actual ID tokens");
    console.log("");
    
    return {
      buyerUid: buyerUser.uid,
      sellerUid: sellerUser.uid,
      seller2Uid: seller2User.uid,
      product1Id: product1Ref.id,
      product2Id: product2Ref.id,
      product3Id: product3Ref.id,
      buyerCustomToken,
      sellerCustomToken,
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

