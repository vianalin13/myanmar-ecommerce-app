/**
 * tests all chat functionality including setup, startChat, and error handling
 * 
 * 1. start Firebase emulators: firebase emulators:start
 * 2. run setup: node scripts/setupTestData.js
 * 3. run tests: node backend/tests/chats.test.js
 */

const axios = require('axios');
const admin = require("firebase-admin");

//initialize firebase admin for token generation
if(!admin.apps.length) {
  admin.initializeApp({
    projectId: "myanmar-ecommerce-prototype",
  });
  
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
}

//configuration
const BASE_URL = "http://localhost:5001/myanmar-ecommerce-prototype/us-central1";
const BUYER_UID = "test-buyer-123";
const SELLER_UID = "test-seller-456";
const PRODUCT_1_ID = "test-product-1";
const PRODUCT_2_ID = "test-product-2";

//test state
let buyerToken = null;
let sellerToken = null;
let chatId = null;

//helper: check if test data exists
async function checkTestData() {
  try {
    const buyer = await admin.auth().getUser(BUYER_UID);
    const seller = await admin.auth().getUser(SELLER_UID);
    const product = await admin.firestore().collection("products").doc(PRODUCT_1_ID).get();
    
    if(!buyer || !seller || !product.exists) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

//helper: get ID token for a user using firebase client SDK
async function getIdToken(uid) {
  try {
    //use firebase client SDK to exchange custom token for ID token
    const { initializeApp } = require("firebase/app");
    const { getAuth, signInWithCustomToken, connectAuthEmulator } = require("firebase/auth");

    //initialize firebase client
    const firebaseConfig = {
      apiKey: "fake-api-key",
      authDomain: "localhost",
      projectId: "myanmar-ecommerce-prototype",
    };

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    connectAuthEmulator(auth, "http://localhost:9099/", { disableWarnings: true });

    //create custom token
    const customToken = await admin.auth().createCustomToken(uid);
    
    //exchange for ID token
    const userCredential = await signInWithCustomToken(auth, customToken);
    const idToken = await userCredential.user.getIdToken();
    
    return idToken;
  } catch (error) {
    console.error(`Error getting token for ${uid}:`, error.message);
    throw error;
  }
}

//helper: make authenticated request
async function makeRequest(method, endpoint, token, data = null) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    if (error.response) {
      return { 
        success: false, 
        error: error.response.data, 
        status: error.response.status 
      };
    }
    throw error;
  }
}

//test 0: check if test data exists
async function testCheckData() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 0: Checking Test Data");
  console.log("=".repeat(60));

  const dataExists = await checkTestData();
  
  if (!dataExists) {
    console.log("XXX test data not found!");
    console.log("");
    console.log("please run setup first:");
    console.log("  node scripts/setupTestData.js");
    console.log("");
    return false;
  }
  
  console.log("test data exists");
  console.log("");
  return true;
}

//test 1: setup - get auth tokens
async function testSetup() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: Setup - Get Auth Tokens");
  console.log("=".repeat(60));

  try {
    buyerToken = await getIdToken(BUYER_UID);
    sellerToken = await getIdToken(SELLER_UID);
    
    console.log("buyer token obtained");
    console.log("seller token obtained");
    console.log("");
    return true;

  } catch (error) {
    console.error("XXX setup failed:", error.message);
    return false;
  }
}

//test 2: create new chat 
async function testCreateNewChat() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Create New Chat (First Time)");
  console.log("=".repeat(60));

  const result = await makeRequest("POST", "/startChat", buyerToken, {
    productId: PRODUCT_1_ID,
  });

  if (result.success) {
    console.log("chat created successfully!");
    console.log(`chat ID: ${result.data.chatId}`);
    console.log(`buyer ID: ${result.data.chat.buyerId}`);
    console.log(`seller ID: ${result.data.chat.sellerId}`);
    console.log(`product ID: ${result.data.chat.currentProductId}`);
    chatId = result.data.chatId;
    return true;

  } else {
    console.error("XXX failed to create chat");
    console.error(`    status: ${result.status}`);
    console.error(`    error: ${JSON.stringify(result.error, null, 2)}`);
    return false;
  }
}

//test 3: Get Existing Chat
async function testGetExistingChat() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: Get Existing Chat (Second Time)");
  console.log("=".repeat(60));

  const result = await makeRequest("POST", "/startChat", buyerToken, {
    productId: PRODUCT_1_ID,
  });

  if (result.success) {
    if (result.data.chatId === chatId) {
      console.log("returned existing chat (same chatId)");
      console.log(`chat ID: ${result.data.chatId}`);
      return true;
    } else {
      console.error("XXX got different chatId (should be same)");
      console.error(`    expected: ${chatId}`);
      console.error(`    got: ${result.data.chatId}`);
      return false;
    }
  } else {
    console.error("XXX failed to get existing chat");
    console.error(`    status: ${result.status}`);
    console.error(`    error: ${JSON.stringify(result.error, null, 2)}`);
    return false;
  }
}

//test 4: different product, same seller
async function testDifferentProductSameSeller() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 4: Different Product, Same Seller");
  console.log("=".repeat(60));

  const result = await makeRequest("POST", "/startChat", buyerToken, {
    productId: PRODUCT_2_ID,
  });

  if (result.success) {
    if (result.data.chatId === chatId) {
      console.log("returned same chat (one chat per buyer-seller)");
      console.log(`chat ID: ${result.data.chatId}`);
      console.log(`current Product ID: ${result.data.chat.currentProductId}`);
      return true;
    } else {
      console.error("XXX got different chatId (should be same)");
      console.error(`    expected: ${chatId}`);
      console.error(`    got: ${result.data.chatId}`);
      return false;
    }
  } else {
    console.error("XXX failed to get chat");
    console.error(`    status: ${result.status}`);
    console.error(`    error: ${JSON.stringify(result.error, null, 2)}`);
    return false;
  }
}

//test 5: error - missing token
async function testMissingToken() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 5: Error - Missing Token");
  console.log("=".repeat(60));

  try {
    const response = await axios.post(
      `${BASE_URL}/startChat`,
      { productId: PRODUCT_1_ID },
      {
        headers: {
          "Content-Type": "application/json",
          //no authorization header
        },
      }
    );
    
    console.error("XXX should have failed but didn't");
    return false;
  } catch (error) {
    if (error.response && error.response.status === 500) {
      const errorData = error.response.data;
      if (errorData.details && errorData.details.includes("authorization")) {
        console.log("correctly rejected request without token");
        console.log(`status: ${error.response.status}`);
        console.log(`error: ${errorData.error}`);
        return true;
      }
    }
    console.error("XXX unexpected error:", error.message);
    return false;
  }
}

//test 6: error - invalid product
async function testInvalidProduct() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 6: Error - Invalid Product");
  console.log("=".repeat(60));

  const result = await makeRequest("POST", "/startChat", buyerToken, {
    productId: "invalid-product-id-12345",
  });

  if (!result.success && result.status === 404) {
    console.log("correctly rejected invalid product");
    console.log(`status: ${result.status}`);
    console.log(`error: ${result.error.error}`);
    return true;
  } else {
    console.error("XXX should have failed but didn't");
    console.error(`    status: ${result.status}`);
    return false;
  }
}

//test 7: error - seller cannot chat with themselves
async function testSellerCannotChatWithSelf() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 7: Error - Seller Cannot Chat with Themselves");
  console.log("=".repeat(60));

  const result = await makeRequest("POST", "/startChat", sellerToken, {
    productId: PRODUCT_1_ID,
  });

  if (!result.success && result.status === 400) {
    console.log("correctly rejected seller chatting with themselves");
    console.log(`status: ${result.status}`);
    console.log(`error: ${result.error.error}`);
    return true;
  } else {
    console.error("XXX should have failed but didn't");
    console.error(`    status: ${result.status}`);
    return false;
  }
}

//main test runner
async function runAllTests() {
  console.log("=".repeat(60));
  console.log("CHAT SYSTEM TESTS");
  console.log("=".repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Buyer UID: ${BUYER_UID}`);
  console.log(`Seller UID: ${SELLER_UID}`);
  console.log(`Product 1 ID: ${PRODUCT_1_ID}`);
  console.log(`Product 2 ID: ${PRODUCT_2_ID}`);
  console.log("=".repeat(60));

  const results = [];

  //check if test data exists first
  const dataExists = await testCheckData();
  if (!dataExists) {
    console.log("\n XXX cannot run tests without test data!");
    console.log("please run: node scripts/setupTestData.js");
    process.exit(1);
  }

  //run tests
  results.push({ test: "Setup", passed: await testSetup() });
  results.push({ test: "Create New Chat", passed: await testCreateNewChat() });
  results.push({ test: "Get Existing Chat", passed: await testGetExistingChat() });
  results.push({ test: "Different Product Same Seller", passed: await testDifferentProductSameSeller() });
  results.push({ test: "Missing Token", passed: await testMissingToken() });
  results.push({ test: "Invalid Product", passed: await testInvalidProduct() });
  results.push({ test: "Seller Cannot Chat with Self", passed: await testSellerCannotChatWithSelf() });

  //summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));
  
  results.forEach(({ test, passed }) => {
    console.log(`${passed ? "✅" : "❌"} ${test}`);
  });
  
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  console.log("");
  console.log(`Total: ${passedCount}/${totalCount} tests passed`);
  console.log("=".repeat(60));

  if (chatId) {
    console.log(`\nChat ID created: ${chatId}`);
  }

  process.exit(passedCount === totalCount ? 0 : 1);
}

//run all tests
runAllTests().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
