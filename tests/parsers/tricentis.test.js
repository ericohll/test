const { parse } = require('../../src/parsers/tricentis');
const fixture = require('../fixtures/tricentis.json');

describe('parsers/tricentis', () => {
  test('produces the pinned D5 metric_type vocabulary with correct values/units', () => {
    const { metrics } = parse(fixture);
    expect(metrics.map((m) => m.metric_type).sort()).toEqual([
      'test_duration_seconds', 'test_pass_rate_pct', 'tests_failed', 'tests_passed', 'tests_skipped', 'tests_total',
    ]);
    const byType = Object.fromEntries(metrics.map((m) => [m.metric_type, m]));
    expect(byType.tests_total).toEqual({ metric_type: 'tests_total', value: 5, unit: 'count' });
    expect(byType.tests_passed).toEqual({ metric_type: 'tests_passed', value: 1, unit: 'count' });
    expect(byType.tests_failed).toEqual({ metric_type: 'tests_failed', value: 1, unit: 'count' });
    // Skipped (TC-4) + Blocked (TC-3).
    expect(byType.tests_skipped).toEqual({ metric_type: 'tests_skipped', value: 2, unit: 'count' });
    expect(byType.test_pass_rate_pct).toEqual({ metric_type: 'test_pass_rate_pct', value: 20, unit: 'percent' });
    expect(byType.test_duration_seconds).toEqual({ metric_type: 'test_duration_seconds', value: 21.8, unit: 'seconds' });
  });

  test('maps every test case to a finding, including passers (so a fix emits a resolved event)', () => {
    const { findings } = parse(fixture);
    expect(findings).toEqual([
      { external_finding_id: 'TC:TC-1', title: 'Checkout with valid card', severity: 'info', status: 'resolved' },
      { external_finding_id: 'TC:TC-2', title: 'Checkout with expired card', severity: 'high', status: 'open' },
      { external_finding_id: 'TC:TC-3', title: 'Refund flow', severity: 'medium', status: 'open' },
      { external_finding_id: 'TC:TC-4', title: 'Partial refund', severity: 'info', status: 'open' },
      { external_finding_id: 'TC:TC-5', title: 'Unrecognized status case', severity: 'info', status: 'open' },
    ]);
  });

  test.each([
    ['Failed', 'high', 'open'], ['Blocked', 'medium', 'open'], ['Skipped', 'info', 'open'],
    ['Passed', 'info', 'resolved'], ['Bogus', 'info', 'open'],
  ])('status %s maps to severity %s / status %s', (input, sev, status) => {
    const raw = { payload: { testCases: [{ id: 'X', name: 'n', status: input, durationSeconds: 1 }] } };
    const f = parse(raw).findings[0];
    expect(f.severity).toBe(sev);
    expect(f.status).toBe(status);
  });

  test('test_pass_rate_pct is omitted (not 0/NaN) when there are no test cases', () => {
    const raw = { payload: { testCases: [] } };
    const { metrics } = parse(raw);
    expect(metrics.find((m) => m.metric_type === 'test_pass_rate_pct')).toBeUndefined();
    expect(metrics.find((m) => m.metric_type === 'tests_total').value).toBe(0);
  });

  test('empty/absent payload never throws', () => {
    expect(parse({ payload: {} }).findings).toEqual([]);
    expect(parse({}).findings).toEqual([]);
  });

  test('parse is pure: repeated calls deep-equal and the input fixture is not mutated', () => {
    const before = JSON.parse(JSON.stringify(fixture));
    const a = parse(fixture);
    const b = parse(fixture);
    expect(a).toEqual(b);
    expect(fixture).toEqual(before);
  });
});
