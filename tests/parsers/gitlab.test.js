const { parse } = require('../../src/parsers/gitlab');
const fixture = require('../fixtures/gitlab.json');

describe('parsers/gitlab', () => {
  test('produces the pinned D5 metric_type vocabulary with correct values/units', () => {
    const { metrics } = parse(fixture);
    expect(metrics.map((m) => m.metric_type).sort()).toEqual([
      'gitlab_open_vulnerabilities', 'gitlab_vulnerabilities_critical', 'gitlab_vulnerabilities_high',
      'open_mrs', 'pipeline_failed_count', 'pipeline_success_rate_pct',
    ]);
    const byType = Object.fromEntries(metrics.map((m) => [m.metric_type, m]));
    expect(byType.open_mrs).toEqual({ metric_type: 'open_mrs', value: 2, unit: 'count' });
    expect(byType.pipeline_success_rate_pct).toEqual({ metric_type: 'pipeline_success_rate_pct', value: 50, unit: 'percent' });
    expect(byType.pipeline_failed_count).toEqual({ metric_type: 'pipeline_failed_count', value: 2, unit: 'count' });
    expect(byType.gitlab_vulnerabilities_critical).toEqual({ metric_type: 'gitlab_vulnerabilities_critical', value: 1, unit: 'count' });
    expect(byType.gitlab_vulnerabilities_high).toEqual({ metric_type: 'gitlab_vulnerabilities_high', value: 1, unit: 'count' });
    // detected (5001) + confirmed (5002) + detected/unknown-severity (5004); dismissed (5003) excluded.
    expect(byType.gitlab_open_vulnerabilities).toEqual({ metric_type: 'gitlab_open_vulnerabilities', value: 3, unit: 'count' });
  });

  test('maps every vulnerability_finding to a finding with the expected severity/status', () => {
    const { findings } = parse(fixture);
    expect(findings).toEqual([
      { external_finding_id: '5001', title: 'SQL Injection', severity: 'critical', status: 'open' },
      { external_finding_id: '5002', title: 'Outdated dependency', severity: 'high', status: 'confirmed' },
      { external_finding_id: '5003', title: 'Weak crypto', severity: 'medium', status: 'false_positive' },
      { external_finding_id: '5004', title: 'Odd severity', severity: 'info', status: 'open' },
    ]);
  });

  test.each([
    ['critical', 'critical'], ['high', 'high'], ['medium', 'medium'], ['low', 'low'], ['info', 'info'],
    ['unknown', 'info'], [undefined, 'info'],
  ])('severity %s maps to %s', (input, expected) => {
    const raw = { payload: { vulnerability_findings: [{ id: 1, name: 'n', severity: input, state: 'detected' }] } };
    expect(parse(raw).findings[0].severity).toBe(expected);
  });

  test.each([
    ['detected', 'open'], ['confirmed', 'confirmed'], ['resolved', 'resolved'], ['dismissed', 'false_positive'],
    ['something_else', 'open'],
  ])('state %s maps to %s', (input, expected) => {
    const raw = { payload: { vulnerability_findings: [{ id: 1, name: 'n', severity: 'low', state: input }] } };
    expect(parse(raw).findings[0].status).toBe(expected);
  });

  test('pipeline_success_rate_pct is omitted (not 0/NaN) when there are no pipelines', () => {
    const raw = { payload: { pipelines: [] } };
    const { metrics } = parse(raw);
    expect(metrics.find((m) => m.metric_type === 'pipeline_success_rate_pct')).toBeUndefined();
    expect(metrics.find((m) => m.metric_type === 'pipeline_failed_count').value).toBe(0);
  });

  test('empty/absent payload never throws', () => {
    expect(parse({ payload: {} })).toEqual({
      metrics: [
        { metric_type: 'open_mrs', value: 0, unit: 'count' },
        { metric_type: 'pipeline_failed_count', value: 0, unit: 'count' },
        { metric_type: 'gitlab_vulnerabilities_critical', value: 0, unit: 'count' },
        { metric_type: 'gitlab_vulnerabilities_high', value: 0, unit: 'count' },
        { metric_type: 'gitlab_open_vulnerabilities', value: 0, unit: 'count' },
      ],
      findings: [],
    });
    expect(parse({})).toEqual(parse({ payload: {} }));
  });

  test('parse is pure: repeated calls deep-equal and the input fixture is not mutated', () => {
    const before = JSON.parse(JSON.stringify(fixture));
    const a = parse(fixture);
    const b = parse(fixture);
    expect(a).toEqual(b);
    expect(fixture).toEqual(before);
  });
});
