const { mapFrom, num, metric, finding } = require('./common');

const SEVERITY_MAP = { BLOCKER: 'critical', CRITICAL: 'high', MAJOR: 'medium', MINOR: 'low', INFO: 'info' };

const MEASURE_METRICS = [
  ['coverage', 'coverage_pct', 'percent'],
  ['duplicated_lines_density', 'duplication_pct', 'percent'],
  ['bugs', 'bugs_count', 'count'],
  ['code_smells', 'code_smells_count', 'count'],
  ['sqale_index', 'tech_debt_minutes', 'minutes'],
];

function mapStatus(issue) {
  const status = String(issue.status || '').toUpperCase();
  if (status === 'OPEN') return 'open';
  if (status === 'CONFIRMED') return 'confirmed';
  if (status === 'REOPENED') return 'reopened';
  if (status === 'CLOSED') return 'resolved';
  if (status === 'RESOLVED') {
    const resolution = String(issue.resolution || '').toUpperCase();
    return resolution === 'FALSE-POSITIVE' || resolution === 'WONTFIX' ? 'false_positive' : 'resolved';
  }
  return 'open';
}

function parse(raw) {
  const payload = (raw && raw.payload) || {};
  const measures = (payload.measures && payload.measures.component && payload.measures.component.measures) || [];
  const issues = payload.issues || [];

  const byKey = new Map(measures.map((m) => [m.metric, m.value]));
  const metrics = [];
  for (const [sourceKey, metricType, unit] of MEASURE_METRICS) {
    if (!byKey.has(sourceKey)) continue;
    metrics.push(metric(metricType, num(byKey.get(sourceKey)), unit));
  }

  const findings = issues.map((issue) => {
    const severity = mapFrom(SEVERITY_MAP, issue.severity, 'info');
    const status = mapStatus(issue);
    return finding(issue.key, issue.message, severity, status);
  });

  const openIssuesCount = findings.filter((f) => f.status !== 'resolved' && f.status !== 'false_positive').length;
  metrics.push(metric('open_issues_count', openIssuesCount, 'count'));

  return { metrics, findings };
}

module.exports = { parse };
