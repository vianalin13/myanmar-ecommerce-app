/**
 * PRODUCTS MODULE
 * Exports all product management functions.
 */

module.exports = {
  ...require("./createProduct"),
  ...require("./updateProduct"),
  ...require("./deleteProduct"),
  ...require("./getSellerProducts"),
  ...require("./getPublicProducts"),
};

