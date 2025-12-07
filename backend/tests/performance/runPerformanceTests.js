/**
 * PERFORMANCE TEST RUNNER
 * runs all performance tests and generates comprehensive reports
 * 
 * usage:
 *   node backend/tests/performance/runPerformanceTests.js
 * 
 * output:
 *   - test-results/performance/run-{timestamp}/ directory with all results
 */

const { execSync } = require("child_process");
const path = require("path");
const resultsCollector = require("../resultsCollector");
const resultsExporter = require("../resultsExporter");

console.log("=".repeat(80));
console.log("PERFORMANCE TEST SUITE");
console.log("=".repeat(80));
console.log("\nThis will run all performance tests and generate reports.");
console.log("Make sure Firebase emulators are running!\n");

//clear previous results
console.log("Clearing previous test results...");
resultsCollector.clear();

//test files to run
const testFiles = [
  "tests/performance/apiPerformance.test.js",
  "tests/performance/chatThroughput.test.js",
  "tests/performance/orderProcessingLatency.test.js",
  "tests/performance/concurrentPerformance.test.js",
];

console.log("\nRunning performance tests...\n");
console.log("Test files:");
testFiles.forEach(file => console.log(`  - ${file}`));
console.log("");

let passed = 0;
let failed = 0;

//get the backend directory (where tests run from)
const backendDir = path.join(__dirname, "../..");

//run each test file
testFiles.forEach((testFile, index) => {
  console.log(`\n[${index + 1}/${testFiles.length}] Running ${testFile}...`);
  console.log("-".repeat(80));

  try {
    execSync(`npm test -- ${testFile}`, {
      stdio: "inherit",
      cwd: backendDir,
      env: { ...process.env, NODE_ENV: "test" },
    });
    passed++;
    console.log(`✅ ${testFile} passed\n`);
  } catch (error) {
    failed++;
    console.error(`❌ ${testFile} failed\n`);
  }
});

//generate reports
console.log("\n" + "=".repeat(80));
console.log("GENERATING REPORTS");
console.log("=".repeat(80));

try {
  //use absolute path relative to backend directory to ensure files are written correctly
  const outputPath = path.join(backendDir, "test-results/performance");
  resultsExporter.exportAllResults(outputPath);
  console.log("\n✅ All reports generated successfully!");
  console.log(`📁 Results location: ${path.resolve(outputPath)}`);
} catch (error) {
  console.error("\n❌ Error generating reports:", error.message);
  console.error(error.stack);
}

//summary
console.log("\n" + "=".repeat(80));
console.log("TEST SUMMARY");
console.log("=".repeat(80));
console.log(`Passed: ${passed}/${testFiles.length}`);
console.log(`Failed: ${failed}/${testFiles.length}`);

if (failed === 0) {
  console.log("\n✅ All performance tests passed!");
  process.exit(0);
} else {
  console.log("\n❌ Some tests failed. Check the output above for details.");
  process.exit(1);
}

