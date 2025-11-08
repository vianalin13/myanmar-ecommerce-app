module.exports = {
  ...require("./registerUser"),
  ...require("./updateUserProfile"),
  ...require("./verifySellerKYC"),
  ...require("./createAdmin"),
  ...require("./verifySellerRole"),
  ...require("./verifyUser"),
};
