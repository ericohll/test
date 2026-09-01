const { SEVERITIES, emptyCounts, foldCounts, riskScore } = require('../src/lib/summary');

describe('summary.emptyCounts', () => {
  test('shape includes all five severities plus total, all zero', () => {
    expect(emptyCounts()).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 });
  });
});

describe('summary.foldCounts', () => {
  test('totals rows and ignores unknown severities', () => {
    const rows = [
      { severity: 'critical', count: 2 },
      { severity: 'high', count: 3 },
      { severity: 'bogus', count: 100 },
    ];
    expect(foldCounts(rows)).toEqual({ critical: 2, high: 3, medium: 0, low: 0, info: 0, total: 5 });
  });

  test('empty input yields emptyCounts()', () => {
    expect(foldCounts([])).toEqual(emptyCounts());
  });
});

describe('summary.riskScore', () => {
  test('weighting: a fail gate with zero findings outranks a pass gate with several highs', () => {
    const failNoFindings = riskScore(emptyCounts(), 'fail');
    const passManyHighs = riskScore({ ...emptyCounts(), high: 5, total: 5 }, 'pass');
    expect(failNoFindings).toBeGreaterThan(passManyHighs);
  });

  test('riskScore(emptyCounts(), "unknown") === 0', () => {
    expect(riskScore(emptyCounts(), 'unknown')).toBe(0);
  });

  test('weights: critical*10 + high*5 + medium*2 + low*1, +100 on fail', () => {
    const counts = { critical: 1, high: 1, medium: 1, low: 1, info: 5, total: 9 };
    expect(riskScore(counts, 'pass')).toBe(10 + 5 + 2 + 1);
    expect(riskScore(counts, 'fail')).toBe(100 + 10 + 5 + 2 + 1);
  });

  test('SEVERITIES lists the five severities in priority order', () => {
    expect(SEVERITIES).toEqual(['critical', 'high', 'medium', 'low', 'info']);
  });
});
