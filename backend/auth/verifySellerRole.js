const { verifyUser } = require("./verifyUser"); // Reuse shared base auth

// Verifies that the authenticated user has the "seller" role
// and has passed KYC (Know Your Customer) verification.
async function verifySellerRole(request) {
  try {
    // First, authenticate the user normally
    const { uid, user } = await verifyUser(request);

    // Role check — must be seller
    if (user.role !== "seller") {
      throw new Error("Unauthorized: user is not a seller");
    }

    // KYC verification check — seller must be verified
    if (user.verificationStatus !== "verified") {
      throw new Error("Seller not verified");
    }

    // Passed all checks
    return { uid, user };
  } catch (err) {
    console.error("verifySellerRole error:", err.message);
    throw new Error("Authentication failed: " + err.message);
  }
}

module.exports = { verifySellerRole };
