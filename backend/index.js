/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const auth = require("./auth");
const products = require("./products/products");
const orders = require("./orders");
const chats = require("./chats");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Initialize Firebase Admin (*only needs to be called once*)
admin.initializeApp();

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

exports.helloWorld = onRequest((request, response) => {
  logger.info("Hello logs!", {structuredData: true});
  response.send("Hello from Firebase!");
});

//phone authentication works through firebase auth console
//no custom function needed for basic OTP flow
//on user sign up, create a user document in firestore
//auto-create user profile when a new user signs up
exports.onUserCreated = onDocumentCreated(
  "users/{userId}",
  async (event) => {
    const userId = event.params.userId;
    logger.info("User created:", userId);

    //additional logic here
    //send welcome notif, set default prefs

    return null;
  }
);

//product management functions
exports.createProduct = products.createProduct;
exports.updateProduct = products.updateProduct;
exports.deleteProduct = products.deleteProduct;
exports.getSellerProducts = products.getSellerProducts;
exports.getPublicProducts = products.getPublicProducts;


//when a user signs up via phone auth, automatically create their firestore profile
//note: onUserCreated trigger not available in v6.0.1
//for now, manually create user docs via emulator UI or use a separate function

//auth callables
exports.registerUser = auth.registerUser;
exports.updateUserProfile = auth.updateUserProfile;
exports.verifySellerKYC = auth.verifySellerKYC;
exports.createAdmin = auth.createAdmin;

//order & payment management functions
exports.createOrder = orders.createOrder;
exports.updateOrderStatus = orders.updateOrderStatus;
exports.getUserOrders = orders.getUserOrders;
exports.getOrderById = orders.getOrderById;
exports.simulatePayment = orders.simulatePayment;
exports.releaseEscrow = orders.releaseEscrow;
//chat functions
exports.startChat = chats.startChat;
exports.sendMessage = chats.sendMessage;
exports.getChatMessages = chats.getChatMessages;
exports.getUserChats = chats.getUserChats;
