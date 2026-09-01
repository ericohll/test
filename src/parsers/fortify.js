const { mapFrom, pct, metric, finding } = require('./common');

const SEVERITY_MAP = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low' };

// Status precedence (first match wins):
//   1. removed        -> resolved
//   2. suppressed      -> false_positive
//   3. primaryTag === 'Not an Issue' -> false_positive
//   4. primaryTag === 'Exploitable' OR audited === true -> confirmed
//   5. else -> open
function mapStatus(issue) {
  if (issue.removed) return 'resolved';
  if (issue.suppressed) return 'false_positive';
  if (issue.primaryTag === 'Not an Issue') return 'false_positive';
  if (issue.primaryTag === 'Exploitable' || issue.audited === true) return 'confirmed';
  return 'open';
}

function parse(raw) {
  const payload = (raw && raw.payload) || {};
  const data = payload.data || [];

  const findings = data.map((issue) => {
    const severity = mapFrom(SEVERITY_MAP, issue.friority, 'info');
    const status = mapStatus(issue);
    return finding(String(issue.issueInstanceId), issue.issueName, severity, status);
  });

  const active = findings.filter((f) => f.status !== 'resolved' && f.status !== 'false_positive');
  const bySeverity = (sev) => active.filter((f) => f.severity === sev).length;

  const metrics = [
    metric('sast_vulnerabilities_critical', bySeverity('critical'), 'count'),
    metric('sast_vulnerabilities_high', bySeverity('high'), 'count'),
    metric('sast_vulnerabilities_medium', bySeverity('medium'), 'count'),
    metric('sast_vulnerabilities_low', bySeverity('low'), 'count'),
    metric('sast_open_vulnerabilities', active.length, 'count'),
  ];

  const auditedCount = data.filter((issue) => issue.audited === true).length;
  const auditedPct = pct(auditedCount, data.length);
  if (auditedPct !== null) metrics.push(metric('sast_audited_pct', auditedPct, 'percent'));

  return { metrics, findings };
}

module.exports = { parse };
