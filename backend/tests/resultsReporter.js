/**
 * JEST CUSTOM REPORTER
 * industry standard way to collect and export test results
 * 
 * this runs in the same process as tests and has access to all test data
 */

const fs = require("fs");
const path = require("path");
const resultsCollector = require("./resultsCollector");
const { exportAllResults } = require("./resultsExporter");

class ResultsReporter {
  constructor(globalConfig, options) {
    this.globalConfig = globalConfig;
    this.options = options;
    this.shouldExport = process.env.E2E_EXPORT_RESULTS === "true";
    this.outputDir = process.env.E2E_OUTPUT_DIR || path.join(__dirname, "../test-results/e2e");
  }

  onRunComplete(contexts, results) {
    //this runs once after all test suites complete
    //load results from file (persists across Jest's module isolation)
    const collectorData = resultsCollector.getAllResults();
    
    //debug: check what's in the collector
    console.log("\n[Reporter] Results collector state:");
    console.log(`  Flows: ${collectorData.flows.length}`);
    console.log(`  API Timings: ${collectorData.apiTimings.length}`);
    console.log(`  Security Checkpoints: ${collectorData.securityCheckpoints.length}`);
    console.log(`  Fraud Prevention: ${collectorData.fraudPrevention.length}`);
    console.log(`  Concurrent Tests: ${collectorData.concurrentTests.length}`);
    console.log(`  Transparency Metrics: ${collectorData.transparencyMetrics?.length || 0}`);
    console.log(`  Audit Trail: ${collectorData.auditTrailCompleteness.length}`);
    
    if (this.shouldExport && (collectorData.flows.length > 0 || collectorData.apiTimings.length > 0)) {
      console.log("\n[Reporter] Exporting all test results...");
      
      //ensure directory exists
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
      }
      
      exportAllResults(this.outputDir);
    } else if (this.shouldExport) {
      console.log("\n[Reporter] WARNING: No results to export. Collector appears empty.");
      console.log("This might indicate tests aren't calling collector methods.");
    }
  }
}

module.exports = ResultsReporter;

