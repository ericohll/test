const { parse } = require('../../src/parsers/sonarqube');
const fixture = require('../fixtures/sonarqube.json');

describe('parsers/sonarqube', () => {
  test('produces the pinned D5 metric_type vocabulary with correct values/units', () => {
    const { metrics } = parse(fixture);
    expect(metrics.map((m) => m.metric_type).sort()).toEqual([
      'bugs_count', 'code_smells_count', 'coverage_pct', 'duplication_pct',
      'open_issues_count', 'tech_debt_minutes',
    ]);
    const byType = Object.fromEntries(metrics.map((m) => [m.metric_type, m]));
    expect(byType.coverage_pct).toEqual({ metric_type: 'coverage_pct', value: 78.4, unit: 'percent' });
    expect(byType.duplication_pct).toEqual({ metric_type: 'duplication_pct', value: 3.2, unit: 'percent' });
    expect(byType.bugs_count).toEqual({ metric_type: 'bugs_count', value: 4, unit: 'count' });
    expect(byType.code_smells_count).toEqual({ metric_type: 'code_smells_count', value: 57, unit: 'count' });
    expect(byType.tech_debt_minutes).toEqual({ metric_type: 'tech_debt_minutes', value: 612, unit: 'minutes' });
    // ISSUE-1 (open) + ISSUE-2 (confirmed) are active; ISSUE-3 (false_positive) and ISSUE-4 (resolved) are not.
    expect(byType.open_issues_count).toEqual({ metric_type: 'open_issues_count', value: 2, unit: 'count' });
  });

  test('maps every issue to a finding with the expected severity/status', () => {
    const { findings } = parse(fixture);
    expect(findings).toHaveLength(4);
    expect(findings).toEqual([
      { external_finding_id: 'ISSUE-1', title: 'Null pointer dereference', severity: 'critical', status: 'open' },
      { external_finding_id: 'ISSUE-2', title: 'Cyclomatic complexity too high', severity: 'medium', status: 'confirmed' },
      { external_finding_id: 'ISSUE-3', title: 'Unused variable', severity: 'low', status: 'false_positive' },
      { external_finding_id: 'ISSUE-4', title: 'Some closed issue', severity: 'info', status: 'resolved' },
    ]);
  });

  test.each([
    ['BLOCKER', 'critical'], ['CRITICAL', 'high'], ['MAJOR', 'medium'], ['MINOR', 'low'], ['INFO', 'info'],
    ['UNKNOWN_SEV', 'info'],
  ])('severity %s maps to %s', (input, expected) => {
    const raw = { payload: { issues: [{ key: 'K', severity: input, status: 'OPEN', message: 'm' }] } };
    expect(parse(raw).findings[0].severity).toBe(expected);
  });

  test.each([
    ['OPEN', undefined, 'open'],
    ['CONFIRMED', undefined, 'confirmed'],
    ['REOPENED', undefined, 'reopened'],
    ['CLOSED', undefined, 'resolved'],
    ['RESOLVED', 'FIXED', 'resolved'],
    ['RESOLVED', 'FALSE-POSITIVE', 'false_positive'],
    ['RESOLVED', 'WONTFIX', 'false_positive'],
    ['SOMETHING_ELSE', undefined, 'open'],
  ])('status %s / resolution %s maps to %s', (status, resolution, expected) => {
    const raw = { payload: { issues: [{ key: 'K', severity: 'MAJOR', status, resolution, message: 'm' }] } };
    expect(parse(raw).findings[0].status).toBe(expected);
  });

  test('measure metrics are omitted (no absent measure keys) on an empty payload; open_issues_count still reports 0; never throws', () => {
    const expected = { metrics: [{ metric_type: 'open_issues_count', value: 0, unit: 'count' }], findings: [] };
    expect(parse({ payload: {} })).toEqual(expected);
    expect(parse({})).toEqual(expected);
  });

  test('parse is pure: repeated calls deep-equal and the input fixture is not mutated', () => {
    const before = JSON.parse(JSON.stringify(fixture));
    const a = parse(fixture);
    const b = parse(fixture);
    expect(a).toEqual(b);
    expect(fixture).toEqual(before);
  });
});
