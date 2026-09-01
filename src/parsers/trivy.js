const { mapFrom, externalId, metric, finding } = require('./common');

const SEVERITY_MAP = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'info' };

function parse(raw) {
  const payload = (raw && raw.payload) || {};
  const results = payload.Results || [];

  const findings = [];
  for (const result of results) {
    const vulns = result.Vulnerabilities || [];
    for (const v of vulns) {
      const severity = mapFrom(SEVERITY_MAP, v.Severity, 'info');
      const id = externalId(result.Target, v.PkgName, v.VulnerabilityID);
      const title = v.Title || v.VulnerabilityID;
      // Trivy is stateless: every scan reports the currently-detected
      // vulnerabilities with no notion of open/resolved of its own.
      findings.push({ ...finding(id, title, severity, 'open'), _fixed: !!v.FixedVersion, _severity: severity });
    }
  }

  const bySeverity = (sev) => findings.filter((f) => f._severity === sev).length;
  const fixableCount = findings.filter((f) => f._fixed).length;

  const metrics = [
    metric('container_vulnerabilities_critical', bySeverity('critical'), 'count'),
    metric('container_vulnerabilities_high', bySeverity('high'), 'count'),
    metric('container_vulnerabilities_medium', bySeverity('medium'), 'count'),
    metric('container_vulnerabilities_low', bySeverity('low'), 'count'),
    metric('container_open_vulnerabilities', findings.length, 'count'),
    metric('container_fixable_vulnerabilities', fixableCount, 'count'),
  ];

  // Strip the internal bookkeeping fields before returning.
  const cleanFindings = findings.map(({ external_finding_id, title, severity, status }) => ({
    external_finding_id, title, severity, status,
  }));

  return { metrics, findings: cleanFindings };
}

module.exports = { parse };
