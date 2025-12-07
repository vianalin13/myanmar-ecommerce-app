#!/usr/bin/env node

/**
 * RUN END-TO-END TESTS
 * script to run all end-to-end tests and export results
 * 
 * usage:
 *   node backend/tests/e2e/runEndToEndTests.js 
 *   node backend/tests/e2e/runEndToEndTests.js --export
 *   node backend/tests/e2e/runEndToEndTests.js --export --output ./custom-output-dir
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const resultsCollector = require("./resultsCollector");

//parse command line arguments
const args = process.argv.slice(2);
const shouldExport = args.includes("--export");
const outputIndex = args.indexOf("--output");
const outputDir = outputIndex !== -1 && args[outputIndex + 1] 
  ? args[outputIndex + 1] 
  : "./test-results/e2e";

console.log("=".repeat(80));
console.log("RUNNING END-TO-END TESTS");
console.log("=".repeat(80));
console.log("");

//clear previous results
resultsCollector.clear();

//clean up any previous export lock file
const lockFile = path.join(outputDir, ".export-lock");
if (fs.existsSync(lockFile)) {
  fs.unlinkSync(lockFile);
}

//explicitly list E2E test files (only these will run)
const e2eTestFiles = [
  "tests/e2e/happyPath.test.js",
  "tests/e2e/fraudPrevention.test.js",
  "tests/e2e/disputeResolution.test.js",
  "tests/e2e/transparency.test.js",
  "tests/e2e/concurrentTransactions.test.js",
];

//set environment variables for Jest teardown
const env = {
  ...process.env,
  E2E_EXPORT_RESULTS: shouldExport ? "true" : "false",
  E2E_OUTPUT_DIR: outputDir,
};

//use Jest config file to avoid path issues
const backendDir = path.join(__dirname, "../..");
const jestConfigPath = path.relative(backendDir, path.join(__dirname, "jest.config.js"))
  .replace(/\\/g, "/"); //convert backslashes to forward slashes

//run Jest tests on only the E2E test files
const jestProcess = spawn("npx", [
  "jest",
  ...e2eTestFiles,
  "--config", jestConfigPath, //use Jest config file
  "--verbose",
  "--forceExit",
  "--runInBand", //run tests serially to avoid conflicts
], {
  stdio: "inherit",
  shell: true,
  cwd: backendDir, //run from backend directory
  env: env,
});

jestProcess.on("close", (code) => {
  console.log("");
  console.log("=".repeat(80));
  
  if (code === 0) {
    console.log("✓ All tests passed!");
  } else {
    console.log(`✗ Tests exited with code ${code}`);
  }
  
  if (shouldExport) {
    //export is handled by Jest teardown, just confirm
    console.log("");
    console.log("Results should have been exported by Jest teardown.");
  } else {
    console.log("");
    console.log("Tip: Run with --export flag to export results to files");
    console.log("Example: node e2e/runEndToEndTests.js --export");
  }
  
  console.log("=".repeat(80));
  process.exit(code);
});

jestProcess.on("error", (error) => {
  console.error("Error running tests:", error);
  process.exit(1);
});

