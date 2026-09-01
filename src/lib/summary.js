// Pure aggregation helpers for the dashboard/portfolio read paths. No I/O.

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

function emptyCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
}

// Folds [{severity, count}] rows (e.g. from countOpenFindingsBySeverity) into
// the shape above. Unknown severities are ignored; total sums only the rows folded in.
function foldCounts(rows) {
  const counts = emptyCounts();
  for (const row of rows || []) {
    if (!SEVERITIES.includes(row.severity)) continue;
    const n = Number(row.count) || 0;
    counts[row.severity] += n;
    counts.total += n;
  }
  return counts;
}

// Risk score weights: a failing gate dominates (+100, since a release that
// can't ship is worse than any amount of open findings), then findings are
// weighted by severity: critical=10, high=5, medium=2, low=1, info=0.
function riskScore(counts, gateStatus) {
  const gatePenalty = gateStatus === 'fail' ? 100 : 0;
  return (
    gatePenalty
    + counts.critical * 10
    + counts.high * 5
    + counts.medium * 2
    + counts.low * 1
  );
}

module.exports = { SEVERITIES, emptyCounts, foldCounts, riskScore };
