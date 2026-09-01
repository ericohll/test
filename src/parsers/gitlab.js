const { mapFrom, pct, metric, finding } = require('./common');

const SEVERITY_MAP = { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'info' };
const STATE_MAP = { detected: 'open', confirmed: 'confirmed', resolved: 'resolved', dismissed: 'false_positive' };

function parse(raw) {
  const payload = (raw && raw.payload) || {};
  const mergeRequests = payload.merge_requests || [];
  const pipelines = payload.pipelines || [];
  const vulnerabilities = payload.vulnerability_findings || [];

  const metrics = [];
  metrics.push(metric('open_mrs', mergeRequests.length, 'count'));

  const successCount = pipelines.filter((p) => p.status === 'success').length;
  const failedCount = pipelines.filter((p) => p.status === 'failed').length;
  const successRate = pct(successCount, pipelines.length);
  if (successRate !== null) metrics.push(metric('pipeline_success_rate_pct', successRate, 'percent'));
  metrics.push(metric('pipeline_failed_count', failedCount, 'count'));

  const findings = vulnerabilities.map((v) => {
    const severity = mapFrom(SEVERITY_MAP, v.severity, 'info');
    const status = mapFrom(STATE_MAP, v.state, 'open');
    return finding(String(v.id), v.name, severity, status);
  });

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const highCount = findings.filter((f) => f.severity === 'high').length;
  metrics.push(metric('gitlab_vulnerabilities_critical', criticalCount, 'count'));
  metrics.push(metric('gitlab_vulnerabilities_high', highCount, 'count'));

  const openVulnCount = findings.filter((f) => f.status === 'open' || f.status === 'confirmed').length;
  metrics.push(metric('gitlab_open_vulnerabilities', openVulnCount, 'count'));

  return { metrics, findings };
}

module.exports = { parse };
