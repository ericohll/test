const { parse } = require('../../src/parsers/fortify');
const fixture = require('../fixtures/fortify.json');

describe('parsers/fortify', () => {
  test('produces the pinned D5 metric_type vocabulary with correct values/units', () => {
    const { metrics } = parse(fixture);
    expect(metrics.map((m) => m.metric_type).sort()).toEqual([
      'sast_audited_pct', 'sast_open_vulnerabilities', 'sast_vulnerabilities_critical',
      'sast_vulnerabilities_high', 'sast_vulnerabilities_low', 'sast_vulnerabilities_medium',
    ]);
    const byType = Object.fromEntries(metrics.map((m) => [m.metric_type, m]));
    // FIN-1 (critical, confirmed/active) + FIN-2 (high, confirmed/active) are active;
    // FIN-3 (suppressed -> false_positive) and FIN-4 (removed -> resolved) are not.
    expect(byType.sast_vulnerabilities_critical).toEqual({ metric_type: 'sast_vulnerabilities_critical', value: 1, unit: 'count' });
    expect(byType.sast_vulnerabilities_high).toEqual({ metric_type: 'sast_vulnerabilities_high', value: 1, unit: 'count' });
    expect(byType.sast_vulnerabilities_medium).toEqual({ metric_type: 'sast_vulnerabilities_medium', value: 0, unit: 'count' });
    expect(byType.sast_vulnerabilities_low).toEqual({ metric_type: 'sast_vulnerabilities_low', value: 0, unit: 'count' });
    expect(byType.sast_open_vulnerabilities).toEqual({ metric_type: 'sast_open_vulnerabilities', value: 2, unit: 'count' });
    // audited === true only for FIN-2, out of 4 total issues -> 25%.
    expect(byType.sast_audited_pct).toEqual({ metric_type: 'sast_audited_pct', value: 25, unit: 'percent' });
  });

  test('maps every issue to a finding with the expected severity/status', () => {
    const { findings } = parse(fixture);
    expect(findings).toEqual([
      { external_finding_id: 'FIN-1', title: 'SQL Injection', severity: 'critical', status: 'confirmed' },
      { external_finding_id: 'FIN-2', title: 'Weak Hash', severity: 'high', status: 'confirmed' },
      { external_finding_id: 'FIN-3', title: 'False alarm', severity: 'medium', status: 'false_positive' },
      { external_finding_id: 'FIN-4', title: 'Old fixed issue', severity: 'low', status: 'resolved' },
    ]);
  });

  test.each([
    ['Critical', 'critical'], ['High', 'high'], ['Medium', 'medium'], ['Low', 'low'], ['Unmapped', 'info'],
  ])('friority %s maps to severity %s', (input, expected) => {
    const raw = { payload: { data: [{ issueInstanceId: 'X', issueName: 'n', friority: input }] } };
    expect(parse(raw).findings[0].severity).toBe(expected);
  });

  test.each([
    [{ removed: true }, 'resolved'],
    [{ suppressed: true }, 'false_positive'],
    [{ primaryTag: 'Not an Issue' }, 'false_positive'],
    [{ primaryTag: 'Exploitable' }, 'confirmed'],
    [{ audited: true }, 'confirmed'],
    [{}, 'open'],
  ])('status precedence: %j maps to %s', (partial, expected) => {
    const raw = { payload: { data: [{ issueInstanceId: 'X', issueName: 'n', friority: 'Low', ...partial }] } };
    expect(parse(raw).findings[0].status).toBe(expected);
  });

  test('sast_audited_pct is omitted (not 0/NaN) when there are no issues', () => {
    const raw = { payload: { data: [] } };
    const { metrics } = parse(raw);
    expect(metrics.find((m) => m.metric_type === 'sast_audited_pct')).toBeUndefined();
    expect(metrics.find((m) => m.metric_type === 'sast_open_vulnerabilities').value).toBe(0);
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
