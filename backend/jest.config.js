/**
 * jest configuration for backend tests
 * excludes custom test runners that should be run directly with Node (auth, chat)
 */

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
  //collect coverage from test files (optional)
  collectCoverageFrom: [
    "**/*.js",
    "!**/node_modules/**",
    "!**/tests/**",
    "!**/*.test.js",
  ],
};

