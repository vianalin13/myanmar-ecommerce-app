/**
 * jest configuration for backend tests
 * excludes custom test runners that should be run directly with Node (auth, chat)
 * includes custom reporter for E2E tests when E2E_EXPORT_RESULTS is set
 */

const reporters = ["default"];

//add custom reporter for E2E tests if export is enabled
if (process.env.E2E_EXPORT_RESULTS === "true") {
  reporters.push(["./tests/resultsReporter.js", {}]);
}

module.exports = {
  testEnvironment: "node",
  testMatch: [
    "**/tests/**/*.test.js",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    //exclude custom test runners (not Jest tests)
    "tests/chat/chats.test.js",  //run with: node backend/tests/chat/chats.test.js
    "tests/auth/auth-test.js",   //run with: node backend/tests/auth/auth-test.js
  ],
  testTimeout: 30000,
  reporters: reporters,
  //collect coverage from test files (optional)
  collectCoverageFrom: [
    "**/*.js",
    "!**/node_modules/**",
    "!**/tests/**",
    "!**/*.test.js",
  ],
};

