// Pure gate-evaluation logic, no I/O. Shared by gate-eval.js (nightly write
// path) and the api-projects/api-releases read paths, so status semantics
// (pass/fail/unknown) can never drift between what gets written and what
// gets displayed.

const { passes } = require('./operators');
const { toDateString } = require('./runDate');

// A project can accumulate several run_dates per metric_type in the metrics
// table (e.g. a late-arriving batch). "Current state" is the highest
// run_date per metric_type; a tie is broken by last-row-wins (input order).
function latestByMetricType(metricRows) {
  const map = new Map();
  for (const row of metricRows || []) {
    const cur = map.get(row.metric_type);
    const rowDate = toDateString(row.run_date);
    if (!cur || rowDate >= toDateString(cur.run_date)) {
      map.set(row.metric_type, row);
    }
  }
  return map;
}

function evaluateGate(metricRows, thresholdRows) {
  const latest = latestByMetricType(metricRows);
  const results = (thresholdRows || []).map((t) => {
    const metric = latest.get(t.metric_type) || null;
    const value = metric ? Number(metric.value) : null;
    const threshold_value = Number(t.threshold_value);
    const passing = metric === null ? null : passes(value, t.operator, threshold_value);
    return {
      metric_type: t.metric_type,
      operator: t.operator,
      threshold_value,
      value,
      unit: metric ? metric.unit : null,
      tool: metric ? metric.tool : null,
      run_date: metric ? toDateString(metric.run_date) : null,
      passing,
    };
  });

  const failed_metrics = results
    .filter((r) => r.passing === false)
    .map(({ metric_type, operator, threshold_value, value, tool, run_date }) => (
      { metric_type, operator, threshold_value, value, tool, run_date }
    ));

  const missing_metrics = results.filter((r) => r.passing === null).map((r) => r.metric_type);

  let status;
  if (results.length === 0) {
    status = 'unknown';
  } else if (failed_metrics.length > 0) {
    status = 'fail';
  } else if (missing_metrics.length > 0) {
    status = 'unknown';
  } else {
    status = 'pass';
  }

  return { status, failed_metrics, missing_metrics, results, thresholds_evaluated: results.length };
}

// One entry per latest metric (not per threshold) -- metrics with no
// configured threshold still need to render on the dashboard.
function describeMetrics(metricRows, thresholdRows) {
  const latest = latestByMetricType(metricRows);
  const thresholdByType = new Map((thresholdRows || []).map((t) => [t.metric_type, t]));
  return [...latest.values()].map((m) => {
    const t = thresholdByType.get(m.metric_type) || null;
    const value = Number(m.value);
    const passing = t ? passes(value, t.operator, Number(t.threshold_value)) : null;
    return {
      metric_type: m.metric_type,
      tool: m.tool,
      value,
      unit: m.unit,
      run_date: toDateString(m.run_date),
      threshold: t ? { operator: t.operator, threshold_value: Number(t.threshold_value) } : null,
      passing,
    };
  });
}

// Always returns an array: handles an already-parsed array (mysql2 JSON
// column / fakeDb), a JSON string, or null/undefined.
function parseFailedMetrics(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

module.exports = { latestByMetricType, evaluateGate, describeMetrics, parseFailedMetrics };
