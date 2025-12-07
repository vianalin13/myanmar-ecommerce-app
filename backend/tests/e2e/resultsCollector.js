/**
 * RESULTS COLLECTOR
 * utility for collecting and aggregating test results for reporting
 * used to generate data tables and graphs for research paper
 * 
 * uses file-based persistence to work across Jest's module isolation
 */

const fs = require("fs");
const path = require("path");

//file-based storage to persist across Jest's module boundaries
const resultsFile = path.join(__dirname, "../../test-results/.collector-cache.json");

class ResultsCollector {
  constructor() {
    this.results = this.loadFromFile();
  }

  //load results from file (persists across module reloads)
  loadFromFile() {
    try {
      if (fs.existsSync(resultsFile)) {
        const data = fs.readFileSync(resultsFile, "utf8");
        return JSON.parse(data);
      }
    } catch (error) {
      //if file is corrupted, start fresh
    }
    return {
      flows: [],
      apiTimings: [],
      securityCheckpoints: [],
      fraudPrevention: [],
      auditTrailCompleteness: [],
      concurrentTests: [],
      transparencyMetrics: [],
      throughput: [],
      orderProcessingLatency: [],
    };
  }

  //saves results to file (ensures persistence)
  saveToFile() {
    try {
      const dir = path.dirname(resultsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resultsFile, JSON.stringify(this.results, null, 2), "utf8");
    } catch (error) {
      //ignore file write errors
    }
  }

  /**
   * record a complete end-to-end flow result
   * 
   * @param {Object} flowResult - flow result object
   * @param {string} flowResult.scenarioName - name of the scenario
   * @param {string} flowResult.flowType - type of flow (happy_path, fraud_prevention, etc.)
   * @param {number} flowResult.totalDuration - total flow duration in ms
   * @param {Array} flowResult.steps - array of step timings
   * @param {number} flowResult.apiCallCount - number of API calls made
   * @param {number} flowResult.securityCheckpointsHit - number of security checkpoints
   * @param {boolean} flowResult.success - whether flow completed successfully
   */
  recordFlow(flowResult) {
    this.results.flows.push({
      ...flowResult,
      timestamp: new Date().toISOString(),
    });
    this.saveToFile();
  }

  /**
   * record individual API timing
   * 
   * @param {string} apiName - name of the API endpoint
   * @param {number} duration - response time in ms
   * @param {boolean} success - whether API call succeeded
   * @param {string} testType - type of test ("e2e" or "performance")
   */
  recordApiTiming(apiName, duration, success = true, testType = "performance") {
    this.results.apiTimings.push({
      apiName,
      duration,
      success,
      testType,
      timestamp: new Date().toISOString(),
    });
    this.saveToFile();
  }

  /**
   * record security checkpoint hit
   * 
   * @param {string} checkpointType - type of checkpoint (escrow, proof_of_delivery, etc.)
   * @param {string} orderId - order ID where checkpoint was hit
   * @param {boolean} passed - whether checkpoint validation passed
   */
  recordSecurityCheckpoint(checkpointType, orderId, passed = true) {
    this.results.securityCheckpoints.push({
      checkpointType,
      orderId,
      passed,
      timestamp: new Date().toISOString(),
    });
    this.saveToFile();
  }

  /**
   * record fraud prevention attempt
   * 
   * @param {string} fraudType - type of fraud attempt
   * @param {boolean} blocked - whether fraud was blocked
   * @param {string} reason - reason for block/allow
   */
  recordFraudPrevention(fraudType, blocked, reason = "") {
    this.results.fraudPrevention.push({
      fraudType,
      blocked,
      reason,
      timestamp: new Date().toISOString(),
    });
    this.saveToFile();
  }

  /**
   * record audit trail completeness
   * 
   * @param {string} orderId - order ID
   * @param {number} eventCount - number of events logged
   * @param {Array<string>} eventTypes - types of events logged
   */
  recordAuditTrailCompleteness(orderId, eventCount, eventTypes = []) {
    this.results.auditTrailCompleteness.push({
      orderId,
      eventCount,
      eventTypes,
      timestamp: new Date().toISOString(),
    });
    this.saveToFile();
  }

  /**
   * record transparency metrics
   * 
   * @param {Object} metrics - transparency metrics
   * @param {string} metrics.orderId - rrder ID
   * @param {number} metrics.totalTransactionSteps - number of transaction steps
   * @param {number} metrics.totalEventsLogged - total events logged
   * @param {number} metrics.uniqueEventTypesCount - number of unique event types
   * @param {number} metrics.transparencyPercentage - transparency coverage percentage
   * @param {Array<string>} metrics.eventTypes - array of event types
   * @param {number} metrics.transactionDuration - total transaction duration in ms
   */
  recordTransparencyMetrics(metrics) {
    this.results.transparencyMetrics.push({
      ...metrics,
      timestamp: new Date().toISOString(),
    });
    this.saveToFile();
  }

  /**
   * record concurrent test result
   * 
   * @param {Object} concurrentResult - concurrent test result
   * @param {number} concurrentResult.userCount - number of concurrent users
   * @param {number} concurrentResult.successCount - number of successful operations
   * @param {number} concurrentResult.failureCount - number of failed operations
   * @param {number} concurrentResult.averageDuration - average duration
   * @param {string} concurrentResult.testType - type of concurrent test
   * @param {number} [concurrentResult.throughput] - optional throughput (ops/second)
   */
  recordConcurrentTest(concurrentResult) {
    this.results.concurrentTests.push({
      ...concurrentResult,
      timestamp: new Date().toISOString(),
    });
    this.saveToFile();
  }

  /**
   * record throughput metric
   * 
   * @param {string} operationType - type of operation (e.g., "concurrent_browse", "message_send")
   * @param {number} throughput - operations per second
   * @param {number} successCount - number of successful operations
   * @param {number} totalDuration - total duration in ms
   * @param {string} testType - type of test ("e2e" or "performance")
   */
  recordThroughput(operationType, throughput, successCount, totalDuration, testType = "performance") {
    this.results.throughput.push({
      operationType,
      throughput,
      successCount,
      totalDuration,
      testType,
      timestamp: new Date().toISOString(),
    });
    this.saveToFile();
  }

  /**
   * record order processing latency
   * 
   * @param {string} orderId - order ID
   * @param {number} totalLatency - total time from order creation to delivery in ms
   * @param {Object} stepTimings - timing for each step
   * @param {number} stepTimings.orderCreation - time to create order
   * @param {number} stepTimings.paymentConfirmation - time to confirm payment
   * @param {number} stepTimings.orderConfirmation - time for seller to confirm
   * @param {number} stepTimings.shipping - time to ship
   * @param {number} stepTimings.delivery - time to deliver
   */
  recordOrderProcessingLatency(orderId, totalLatency, stepTimings = {}) {
    this.results.orderProcessingLatency.push({
      orderId,
      totalLatency,
      stepTimings,
      timestamp: new Date().toISOString(),
    });
    this.saveToFile();
  }

  /**
   * get aggregated API timing statistics
   * 
   * @param {string} testType - optional filter by test type ("e2e" or "performance")
   * @returns {Object} aggregated statistics by API
   */
  getApiTimingStats(testType = null) {
    const apiGroups = {};
    
    this.results.apiTimings.forEach(timing => {
      // Filter by testType if provided
      if (testType && timing.testType !== testType) {
        return;
      }
      if (!apiGroups[timing.apiName]) {
        apiGroups[timing.apiName] = [];
      }
      if (timing.success) {
        apiGroups[timing.apiName].push(timing.duration);
      }
    });

    const stats = {};
    Object.keys(apiGroups).forEach(apiName => {
      const durations = apiGroups[apiName];
      const sum = durations.reduce((a, b) => a + b, 0);
      const avg = sum / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      const sorted = [...durations].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      stats[apiName] = {
        count: durations.length,
        average: Math.round(avg * 100) / 100,
        min,
        max,
        median,
        unit: "ms",
      };
    });

    return stats;
  }

  /**
   * get fraud prevention statistics
   * 
   * @returns {Object} fraud prevention stats by fraud type
   */
  getFraudPreventionStats() {
    const fraudGroups = {};
    
    this.results.fraudPrevention.forEach(record => {
      if (!fraudGroups[record.fraudType]) {
        fraudGroups[record.fraudType] = { total: 0, blocked: 0 };
      }
      fraudGroups[record.fraudType].total++;
      if (record.blocked) {
        fraudGroups[record.fraudType].blocked++;
      }
    });

    const stats = {};
    Object.keys(fraudGroups).forEach(fraudType => {
      const group = fraudGroups[fraudType];
      stats[fraudType] = {
        totalAttempts: group.total,
        blocked: group.blocked,
        allowed: group.total - group.blocked,
        blockRate: group.total > 0 
          ? Math.round((group.blocked / group.total) * 10000) / 100 
          : 0,
      };
    });

    return stats;
  }

  /**
   * get throughput statistics
   * 
   * @returns {Object} aggregated throughput stats by operation type
   */
  getThroughputStats() {
    const throughputGroups = {};
    
    this.results.throughput.forEach(record => {
      if (!throughputGroups[record.operationType]) {
        throughputGroups[record.operationType] = [];
      }
      throughputGroups[record.operationType].push(record.throughput);
    });

    const stats = {};
    Object.keys(throughputGroups).forEach(operationType => {
      const values = throughputGroups[operationType];
      const sum = values.reduce((a, b) => a + b, 0);
      const avg = sum / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);

      stats[operationType] = {
        count: values.length,
        average: Math.round(avg * 100) / 100,
        min: Math.round(min * 100) / 100,
        max: Math.round(max * 100) / 100,
        unit: "ops/second",
      };
    });

    return stats;
  }

  /**
   * get order processing latency statistics
   * 
   * @returns {Object} aggregated latency stats
   */
  getOrderProcessingLatencyStats() {
    if (this.results.orderProcessingLatency.length === 0) {
      return {
        count: 0,
        averageTotalLatency: null,
        averageStepTimings: {},
      };
    }

    const totalLatencies = this.results.orderProcessingLatency.map(r => r.totalLatency);
    const avgTotal = totalLatencies.reduce((a, b) => a + b, 0) / totalLatencies.length;

    // Aggregate step timings
    const stepTimingGroups = {};
    this.results.orderProcessingLatency.forEach(record => {
      Object.keys(record.stepTimings || {}).forEach(step => {
        if (!stepTimingGroups[step]) {
          stepTimingGroups[step] = [];
        }
        stepTimingGroups[step].push(record.stepTimings[step]);
      });
    });

    const avgStepTimings = {};
    Object.keys(stepTimingGroups).forEach(step => {
      const values = stepTimingGroups[step];
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      avgStepTimings[step] = Math.round(avg * 100) / 100;
    });

    return {
      count: this.results.orderProcessingLatency.length,
      averageTotalLatency: Math.round(avgTotal * 100) / 100,
      averageStepTimings: avgStepTimings,
      unit: "ms",
    };
  }

  /**
   * get all results for export
   * 
   * @returns {Object} all collected results with aggregated statistics
   */
  getAllResults() {
    // reload from file to ensure we have latest data across module boundaries
    this.results = this.loadFromFile();
    return {
      ...this.results,
      aggregated: {
        apiTimings: this.getApiTimingStats(),
        apiTimingsE2E: this.getApiTimingStats("e2e"),
        apiTimingsPerformance: this.getApiTimingStats("performance"),
        fraudPrevention: this.getFraudPreventionStats(),
        throughput: this.getThroughputStats(),
        orderProcessingLatency: this.getOrderProcessingLatencyStats(),
      },
    };
  }

  /**
   * clear all results (useful for test isolation)
   */
  clear() {
    this.results = {
      flows: [],
      apiTimings: [],
      securityCheckpoints: [],
      fraudPrevention: [],
      auditTrailCompleteness: [],
      concurrentTests: [],
      transparencyMetrics: [],
      throughput: [],
      orderProcessingLatency: [],
    };
    this.saveToFile();
  }
}

// singleton instance - single shared instance across all tests
const collector = new ResultsCollector();

module.exports = collector;

