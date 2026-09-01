const { pct, num, externalId, metric, finding } = require('./common');

// Failed -> (high, open); Blocked -> (medium, open); Skipped -> (info, open);
// Passed -> (info, resolved) so a test going from failing to passing emits a
// 'resolved' finding lifecycle event. Any other/unrecognised status falls
// back to (info, open).
function mapSeverityStatus(status) {
  switch (status) {
    case 'Failed': return { severity: 'high', status: 'open' };
    case 'Blocked': return { severity: 'medium', status: 'open' };
    case 'Skipped': return { severity: 'info', status: 'open' };
    case 'Passed': return { severity: 'info', status: 'resolved' };
    default: return { severity: 'info', status: 'open' };
  }
}

function parse(raw) {
  const payload = (raw && raw.payload) || {};
  const testCases = payload.testCases || [];

  const findings = testCases.map((tc) => {
    const { severity, status } = mapSeverityStatus(tc.status);
    return finding(externalId('TC', tc.id), tc.name, severity, status);
  });

  const total = testCases.length;
  const passed = testCases.filter((tc) => tc.status === 'Passed').length;
  const failed = testCases.filter((tc) => tc.status === 'Failed').length;
  const skipped = testCases.filter((tc) => tc.status === 'Skipped' || tc.status === 'Blocked').length;
  const durationSeconds = testCases.reduce((sum, tc) => sum + num(tc.durationSeconds), 0);

  const metrics = [
    metric('tests_total', total, 'count'),
    metric('tests_passed', passed, 'count'),
    metric('tests_failed', failed, 'count'),
    metric('tests_skipped', skipped, 'count'),
    metric('test_duration_seconds', durationSeconds, 'seconds'),
  ];

  const passRate = pct(passed, total);
  if (passRate !== null) metrics.push(metric('test_pass_rate_pct', passRate, 'percent'));

  return { metrics, findings };
}

module.exports = { parse };
