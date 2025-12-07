/**
 * Jest configuration for E2E tests
 */

module.exports = {
  testEnvironment: "node",
  reporters: [
    "default",
    ["../helpers/resultsReporter.js", {}], // Custom reporter for exporting results
  ],
  testTimeout: 30000,
};

