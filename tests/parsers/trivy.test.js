const { parse } = require('../../src/parsers/trivy');
const fixture = require('../fixtures/trivy.json');

describe('parsers/trivy', () => {
  test('produces the pinned D5 metric_type vocabulary with correct values/units', () => {
    const { metrics } = parse(fixture);
    expect(metrics.map((m) => m.metric_type).sort()).toEqual([
      'container_fixable_vulnerabilities', 'container_open_vulnerabilities',
      'container_vulnerabilities_critical', 'container_vulnerabilities_high',
      'container_vulnerabilities_low', 'container_vulnerabilities_medium',
    ]);
    const byType = Object.fromEntries(metrics.map((m) => [m.metric_type, m]));
    expect(byType.container_vulnerabilities_critical).toEqual({ metric_type: 'container_vulnerabilities_critical', value: 1, unit: 'count' });
    expect(byType.container_vulnerabilities_high).toEqual({ metric_type: 'container_vulnerabilities_high', value: 1, unit: 'count' });
    expect(byType.container_vulnerabilities_medium).toEqual({ metric_type: 'container_vulnerabilities_medium', value: 1, unit: 'count' });
    expect(byType.container_vulnerabilities_low).toEqual({ metric_type: 'container_vulnerabilities_low', value: 0, unit: 'count' });
    expect(byType.container_open_vulnerabilities).toEqual({ metric_type: 'container_open_vulnerabilities', value: 4, unit: 'count' });
    // CVE-2026-0001 and CVE-2026-0003 have a non-empty FixedVersion.
    expect(byType.container_fixable_vulnerabilities).toEqual({ metric_type: 'container_fixable_vulnerabilities', value: 2, unit: 'count' });
  });

  test('maps every vulnerability to a finding, all status open (Trivy is stateless)', () => {
    const { findings } = parse(fixture);
    expect(findings).toHaveLength(4);
    expect(findings.every((f) => f.status === 'open')).toBe(true);
    expect(findings[0]).toEqual({
      external_finding_id: 'payments-api:latest (alpine 3.19):openssl:CVE-2026-0001',
      title: 'OpenSSL buffer overflow',
      severity: 'critical',
      status: 'open',
    });
    // Empty Title falls back to the VulnerabilityID.
    expect(findings[2].title).toBe('CVE-2026-0003');
  });

  test.each([
    ['CRITICAL', 'critical'], ['HIGH', 'high'], ['MEDIUM', 'medium'], ['LOW', 'low'], ['UNKNOWN', 'info'],
    ['garbage', 'info'],
  ])('severity %s maps to %s', (input, expected) => {
    const raw = { payload: { Results: [{ Target: 't', Vulnerabilities: [{ VulnerabilityID: 'V', PkgName: 'p', Severity: input }] }] } };
    expect(parse(raw).findings[0].severity).toBe(expected);
  });

  test('missing Vulnerabilities array on a Result is treated as empty', () => {
    const raw = { payload: { Results: [{ Target: 't' }] } };
    expect(parse(raw)).toEqual({
      metrics: [
        { metric_type: 'container_vulnerabilities_critical', value: 0, unit: 'count' },
        { metric_type: 'container_vulnerabilities_high', value: 0, unit: 'count' },
        { metric_type: 'container_vulnerabilities_medium', value: 0, unit: 'count' },
        { metric_type: 'container_vulnerabilities_low', value: 0, unit: 'count' },
        { metric_type: 'container_open_vulnerabilities', value: 0, unit: 'count' },
        { metric_type: 'container_fixable_vulnerabilities', value: 0, unit: 'count' },
      ],
      findings: [],
    });
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
