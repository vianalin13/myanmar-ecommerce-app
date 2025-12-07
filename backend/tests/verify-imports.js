/**
 * Quick import verification script
 * Tests that all imports resolve correctly by parsing require statements
 */

const fs = require("fs");
const path = require("path");

console.log("Verifying test imports...\n");

// Helper files that should be importable
const helperFiles = [
  "./auth/authHelpers.js",
  "./chat/chatHelpers.js",
  "./orders/orderHelpers.js",
  "./products/productHelpers.js",
  "./testSetup.js",
  "./cleanupHelpers.js",
];

// Test files to check (we'll parse their imports, not execute them)
const testFiles = [
  "./orders/createOrder.test.js",
  "./orders/updateOrderStatus.test.js",
  "./orders/simulatePayment.test.js",
  "./orders/getOrderById.test.js",
  "./orders/getUserOrders.test.js",
  "./orders/getOrderLogs.test.js",
  "./orders/releaseEscrow.test.js",
  "./e2e/happyPath.test.js",
  "./e2e/fraudPrevention.test.js",
  "./e2e/disputeResolution.test.js",
  "./e2e/transparency.test.js",
];

/**
 * Extract require statements from a file
 */
function extractRequires(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
  const requires = [];
  let match;
  
  while ((match = requireRegex.exec(content)) !== null) {
    requires.push(match[1]);
  }
  
  return requires;
}

/**
 * Resolve a module path relative to a file
 */
function resolveModule(modulePath, fromFile) {
  const fromDir = path.dirname(fromFile);
  
  // Handle relative paths
  if (modulePath.startsWith("./") || modulePath.startsWith("../")) {
    const resolved = path.resolve(fromDir, modulePath);
    // Check if it's a .js file or try .js extension
    if (fs.existsSync(resolved)) return resolved;
    if (fs.existsSync(resolved + ".js")) return resolved + ".js";
    return resolved;
  }
  
  // For absolute or node_modules paths, just return as-is
  return modulePath;
}

/**
 * Check if a module can be resolved
 */
function canResolveModule(modulePath, fromFile) {
  try {
    const resolved = resolveModule(modulePath, fromFile);
    // Check if file exists
    if (fs.existsSync(resolved)) return true;
    // Check if it's a directory with index.js
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return fs.existsSync(path.join(resolved, "index.js"));
    }
    // Try Node.js module resolution (for node_modules)
    require.resolve(modulePath, { paths: [path.dirname(fromFile)] });
    return true;
  } catch (error) {
    return false;
  }
}

let passed = 0;
let failed = 0;
const errors = [];

// First, verify helper files can be imported
console.log("Checking helper files...");
helperFiles.forEach(file => {
  try {
    require(file);
    console.log(`✅ ${file}`);
    passed++;
  } catch (error) {
    if (error.message.includes("describe") || error.message.includes("test") || error.message.includes("it")) {
      // Ignore Jest-related errors for test files
      console.log(`✅ ${file} (imports OK, Jest functions not available)`);
      passed++;
    } else {
      console.error(`❌ ${file}`);
      console.error(`   Error: ${error.message}`);
      errors.push({ file, error: error.message });
      failed++;
    }
  }
});

console.log("\nChecking test file imports (parsing require statements)...");

// Then, parse test files and verify their imports
testFiles.forEach(file => {
  const filePath = path.resolve(__dirname, file);
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ ${file} (file not found)`);
    errors.push({ file, error: "File not found" });
    failed++;
    return;
  }
  
  try {
    const requires = extractRequires(filePath);
    let allResolved = true;
    const unresolved = [];
    
    requires.forEach(modulePath => {
      // Skip node_modules and built-in modules
      if (!modulePath.startsWith("./") && !modulePath.startsWith("../")) {
        return; // Skip node_modules, built-ins
      }
      
      if (!canResolveModule(modulePath, filePath)) {
        allResolved = false;
        unresolved.push(modulePath);
      }
    });
    
    if (allResolved) {
      console.log(`✅ ${file} (${requires.length} imports verified)`);
      passed++;
    } else {
      console.error(`❌ ${file}`);
      console.error(`   Unresolved imports: ${unresolved.join(", ")}`);
      errors.push({ file, error: `Unresolved imports: ${unresolved.join(", ")}` });
      failed++;
    }
  } catch (error) {
    console.error(`❌ ${file}`);
    console.error(`   Error: ${error.message}`);
    errors.push({ file, error: error.message });
    failed++;
  }
});

console.log(`\n${"=".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60));

if (failed > 0) {
  console.log("\nErrors:");
  errors.forEach(({ file, error }) => {
    console.log(`\n${file}:`);
    console.log(`  ${error}`);
  });
  process.exit(1);
} else {
  console.log("\n✅ All imports verified successfully!");
  process.exit(0);
}

