/**
 * TIMING HELPERS
 * utilities for measuring API response times and flow durations
 * used for performance metrics collection in end-to-end tests
 */

/**
 * measure execution time of async functions
 * e2e flow, ex) happypath.test.js -> browseproduct to startchat to createorder
 * 
 * @param {Function} fn - async function to measure
 * @param {string} operationName - name of the operation (for logging)
 * @returns {Promise<{result: *, duration: number, operationName: string, error: string|null, timestamp: string}>}
 */
async function measureTime(fn, operationName = "operation") {
  const startTime = Date.now();
  let result;
  let error = null;

  try {
    result = await fn();
  } catch (e) {
    error = e;
    throw e;
  } finally {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    return {
      result: error ? null : result, //if error return null, else return result
      duration,
      operationName,
      error: error ? error.message : null,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * measure multiple operations and collect timing data
 * for concurrency ex) 5 users browsing simultaneously
 * 
 * @param {Array<{name: string, fn: Function}>} operations - array of operations to measure
 * @returns {Promise<Array<{operationName: string, duration: number, success: boolean, error: string|null}>>}
 */
async function measureMultipleOperations(operations) {
  const results = [];

  for (const op of operations) {
    try {
      const measurement = await measureTime(op.fn, op.name);
      results.push({
        operationName: measurement.operationName,
        duration: measurement.duration,
        success: !measurement.error,
        error: measurement.error || null,
      });
    } catch (error) {
      results.push({
        operationName: op.name,
        duration: null,
        success: false,
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * calculate statistics from timing measurements
 * 
 * @param {Array<{duration: number, success: boolean}>} measurements - Array of timing measurements
 * @returns {Object} statistics object with count, average, min, max, median, total
 */
function calculateTimingStats(measurements) {
  const validMeasurements = measurements.filter(m => m.duration !== null && m.success);
  
  if (validMeasurements.length === 0) {
    return {
      count: 0,
      average: null,
      min: null,
      max: null,
      median: null,
      total: null,
    };
  }

  const durations = validMeasurements.map(m => m.duration).sort((a, b) => a - b);
  const sum = durations.reduce((acc, val) => acc + val, 0);
  const average = sum / durations.length;
  const min = durations[0];
  const max = durations[durations.length - 1];
  const median = durations[Math.floor(durations.length / 2)];
  const total = sum;

  return {
    count: validMeasurements.length,
    average: Math.round(average * 100) / 100,
    min,
    max,
    median,
    total: Math.round(total * 100) / 100,
    unit: "ms",
  };
}

/**
 * format timing results for reporting
 * 
 * @param {Object} stats - statistics object from calculateTimingStats
 * @param {string} operationName - name of the operation
 * @returns {Object} formatted results
 */
function formatTimingResults(stats, operationName) {
  return {
    operation: operationName,
    ...stats,
  };
}

module.exports = {
  measureTime,
  measureMultipleOperations,
  calculateTimingStats,
  formatTimingResults,
};

