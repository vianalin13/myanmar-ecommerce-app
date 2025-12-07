/**
 * RESULTS EXPORTER
 * utility for exporting test results to JSON/CSV for research paper analysis
 */

const fs = require("fs");
const path = require("path");
const resultsCollector = require("../e2e/resultsCollector");

/**
 * export results to JSON file
 * 
 * @param {string} outputPath - path to output file
 */
function exportToJSON(outputPath) {
  const results = resultsCollector.getAllResults();
  const json = JSON.stringify(results, null, 2);
  
  //ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, json, "utf8");
  console.log(`Results exported to: ${outputPath}`);
}

/**
 * export API timing results to CSV format
 * 
 * @param {string} outputPath - path to output CSV file
 */
function exportApiTimingsToCSV(outputPath) {
  const stats = resultsCollector.getApiTimingStats();
  const rows = [];
  
  //header
  rows.push("API Name,Count,Average (ms),Min (ms),Max (ms),Median (ms)");
  
  //data rows
  Object.keys(stats).forEach(apiName => {
    const stat = stats[apiName];
    rows.push(
      `${apiName},${stat.count},${stat.average},${stat.min},${stat.max},${stat.median}`
    );
  });
  
  //ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, rows.join("\n"), "utf8");
  console.log(`API timings exported to: ${outputPath}`);
}

/**
 *export flow results to CSV format
 * 
 * @param {string} outputPath - path to output CSV file
 */
function exportFlowsToCSV(outputPath) {
  const results = resultsCollector.getAllResults();
  const rows = [];
  
  //header
  rows.push("Scenario Name,Flow Type,Total Duration (ms),API Call Count,Security Checkpoints,Success");
  
  //data rows
  results.flows.forEach(flow => {
    rows.push(
      `"${flow.scenarioName}",${flow.flowType},${flow.totalDuration},${flow.apiCallCount},${flow.securityCheckpointsHit},${flow.success}`
    );
  });
  
  //ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, rows.join("\n"), "utf8");
  console.log(`Flow results exported to: ${outputPath}`);
}

/**
 *export fraud prevention stats to CSV
 * 
 * @param {string} outputPath - path to output CSV file
 */
function exportFraudPreventionToCSV(outputPath) {
  const stats = resultsCollector.getFraudPreventionStats();
  const rows = [];
  
  //header
  rows.push("Fraud Type,Total Attempts,Blocked,Allowed,Block Rate (%)");
  
  //data rows
  Object.keys(stats).forEach(fraudType => {
    const stat = stats[fraudType];
    rows.push(
      `${fraudType},${stat.totalAttempts},${stat.blocked},${stat.allowed},${stat.blockRate}`
    );
  });
  
  //ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, rows.join("\n"), "utf8");
  console.log(`Fraud prevention stats exported to: ${outputPath}`);
}

/**
 *generate summary report
 * 
 * @param {string} outputPath - path to output text file
 */
function generateSummaryReport(outputPath) {
  const results = resultsCollector.getAllResults();
  const lines = [];
  
  lines.push("=".repeat(80));
  lines.push("END-TO-END TEST RESULTS SUMMARY");
  lines.push("=".repeat(80));
  lines.push("");
  
  //flow summary
  lines.push("FLOW RESULTS:");
  lines.push("-".repeat(80));
  if (results.flows.length > 0) {
    const totalFlows = results.flows.length;
    const successfulFlows = results.flows.filter(f => f.success).length;
    const avgDuration = results.flows.reduce((sum, f) => sum + f.totalDuration, 0) / totalFlows;
    const totalCheckpoints = results.flows.reduce((sum, f) => sum + f.securityCheckpointsHit, 0);
    
    lines.push(`Total Flows Tested: ${totalFlows}`);
    lines.push(`Successful Flows: ${successfulFlows} (${(successfulFlows/totalFlows*100).toFixed(1)}%)`);
    lines.push(`Average Flow Duration: ${avgDuration.toFixed(2)}ms`);
    lines.push(`Total Security Checkpoints Hit: ${totalCheckpoints}`);
    lines.push(`Average Checkpoints per Flow: ${(totalCheckpoints/totalFlows).toFixed(1)}`);
  } else {
    lines.push("No flow results recorded.");
  }
  lines.push("");
  
  //API timing summary
  lines.push("API PERFORMANCE:");
  lines.push("-".repeat(80));
  const apiStats = resultsCollector.getApiTimingStats();
  if (Object.keys(apiStats).length > 0) {
    Object.keys(apiStats).forEach(apiName => {
      const stat = apiStats[apiName];
      lines.push(`${apiName}:`);
      lines.push(`  Count: ${stat.count}`);
      lines.push(`  Average: ${stat.average}ms`);
      lines.push(`  Min: ${stat.min}ms`);
      lines.push(`  Max: ${stat.max}ms`);
      lines.push(`  Median: ${stat.median}ms`);
      lines.push("");
    });
  } else {
    lines.push("No API timing results recorded.");
  }
  
  //fraud prevention summary
  lines.push("FRAUD PREVENTION:");
  lines.push("-".repeat(80));
  const fraudStats = resultsCollector.getFraudPreventionStats();
  if (Object.keys(fraudStats).length > 0) {
    Object.keys(fraudStats).forEach(fraudType => {
      const stat = fraudStats[fraudType];
      lines.push(`${fraudType}:`);
      lines.push(`  Total Attempts: ${stat.totalAttempts}`);
      lines.push(`  Blocked: ${stat.blocked}`);
      lines.push(`  Allowed: ${stat.allowed}`);
      lines.push(`  Block Rate: ${stat.blockRate}%`);
      lines.push("");
    });
  } else {
    lines.push("No fraud prevention results recorded.");
  }
  
  //audit trail summary
  lines.push("AUDIT TRAIL COMPLETENESS:");
  lines.push("-".repeat(80));
  if (results.auditTrailCompleteness.length > 0) {
    const avgEvents = results.auditTrailCompleteness.reduce((sum, a) => sum + a.eventCount, 0) / results.auditTrailCompleteness.length;
    lines.push(`Orders with Audit Trails: ${results.auditTrailCompleteness.length}`);
    lines.push(`Average Events per Order: ${avgEvents.toFixed(1)}`);
  } else {
    lines.push("No audit trail results recorded.");
  }
  lines.push("");
  
  //concurrent test summary
  lines.push("CONCURRENT TEST RESULTS:");
  lines.push("-".repeat(80));
  if (results.concurrentTests.length > 0) {
    results.concurrentTests.forEach(test => {
      lines.push(`${test.testType}:`);
      lines.push(`  Concurrent Users: ${test.userCount}`);
      lines.push(`  Success Count: ${test.successCount}`);
      lines.push(`  Failure Count: ${test.failureCount}`);
      lines.push(`  Average Duration: ${test.averageDuration}ms`);
      if (test.throughput) {
        lines.push(`  Throughput: ${test.throughput} ops/second`);
      }
      lines.push("");
    });
  } else {
    lines.push("No concurrent test results recorded.");
  }
  
  lines.push("=".repeat(80));
  
  //ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
  console.log(`Summary report generated: ${outputPath}`);
}

/**
 * export all results in multiple formats
 * 
 * @param {string} outputDir - output directory (default: ./test-results)
 */
function exportAllResults(outputDir = "./test-results") {
  // Create timestamped subfolder for this test run
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const runOutputDir = path.join(outputDir, `run-${timestamp}`);
  
  // Create the run-specific directory
  if (!fs.existsSync(runOutputDir)) {
    fs.mkdirSync(runOutputDir, { recursive: true });
  }
  
  // Export all files to the timestamped subfolder
  exportToJSON(path.join(runOutputDir, "results.json"));
  exportApiTimingsToCSV(path.join(runOutputDir, "api-timings.csv"));
  exportFlowsToCSV(path.join(runOutputDir, "flows.csv"));
  exportFraudPreventionToCSV(path.join(runOutputDir, "fraud-prevention.csv"));
  generateSummaryReport(path.join(runOutputDir, "summary.txt"));
  
  console.log(`\nAll results exported to: ${runOutputDir}`);
  console.log(`Run timestamp: ${timestamp}`);
}

module.exports = {
  exportToJSON,
  exportApiTimingsToCSV,
  exportFlowsToCSV,
  exportFraudPreventionToCSV,
  generateSummaryReport,
  exportAllResults,
};

