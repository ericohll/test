const crypto = require('crypto');
const {
  SEVERITIES, STATUSES, mapFrom, assertSeverity, assertStatus, num, pct,
  externalId, truncate, metric, finding,
} = require('../../src/parsers/common');
const { toMysqlDatetime } = require('../../src/lib/runDate');

describe('parsers/common', () => {
  test('SEVERITIES and STATUSES match the DB ENUMs', () => {
    expect(SEVERITIES).toEqual(['critical', 'high', 'medium', 'low', 'info']);
    expect(STATUSES).toEqual(['open', 'confirmed', 'resolved', 'false_positive', 'reopened']);
  });

  test('mapFrom is case-insensitive and falls back on miss', () => {
    const table = { BLOCKER: 'critical', Major: 'medium' };
    expect(mapFrom(table, 'blocker', 'info')).toBe('critical');
    expect(mapFrom(table, 'MAJOR', 'info')).toBe('medium');
    expect(mapFrom(table, 'nope', 'info')).toBe('info');
    expect(mapFrom(table, null, 'info')).toBe('info');
    expect(mapFrom(table, undefined, 'info')).toBe('info');
  });

  test('assertSeverity/assertStatus throw on values the ENUM would reject', () => {
    expect(() => assertSeverity('critical')).not.toThrow();
    expect(() => assertSeverity('bogus')).toThrow();
    expect(() => assertStatus('open')).not.toThrow();
    expect(() => assertStatus('bogus')).toThrow();
  });

  test('num tolerantly coerces strings and falls back on non-numeric input', () => {
    expect(num('78.4')).toBe(78.4);
    expect(num(5)).toBe(5);
    expect(num(null)).toBe(0);
    expect(num(undefined, -1)).toBe(-1);
    expect(num('not-a-number', 7)).toBe(7);
    expect(num('')).toBe(0);
  });

  test('pct rounds to 2dp and returns null on a zero denominator', () => {
    expect(pct(1, 5)).toBe(20);
    expect(pct(2, 3)).toBe(66.67);
    expect(pct(0, 0)).toBeNull();
    expect(pct(5, 0)).toBeNull();
  });

  test('externalId joins parts with a colon', () => {
    expect(externalId('a', 'b', 'c')).toBe('a:b:c');
    expect(externalId('CVE-1', 'pkg', 1)).toBe('CVE-1:pkg:1');
  });

  test('externalId truncates deterministically with a hash tail when the joined id exceeds 255 chars', () => {
    const longPart = 'x'.repeat(300);
    const id = externalId(longPart, 'pkg');
    expect(id.length).toBe(255);
    expect(id).toMatch(/^x{214}~[0-9a-f]{40}$/);

    const full = `${longPart}:pkg`;
    const expectedHash = crypto.createHash('sha256').update(full).digest('hex').slice(0, 40);
    expect(id).toBe(`${full.slice(0, 214)}~${expectedHash}`);

    // Deterministic: same input -> same truncated id.
    expect(externalId(longPart, 'pkg')).toBe(id);
  });

  test('truncate leaves short strings alone and clips long ones', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a'.repeat(20), 10)).toBe('a'.repeat(10));
    expect(truncate(null, 10)).toBeNull();
  });

  test('metric/finding builders shape rows correctly', () => {
    expect(metric('coverage_pct', 80, 'percent')).toEqual({ metric_type: 'coverage_pct', value: 80, unit: 'percent' });
    const f = finding('EXT-1', 'a'.repeat(600), 'high', 'open');
    expect(f.external_finding_id).toBe('EXT-1');
    expect(f.title).toHaveLength(512);
    expect(f.severity).toBe('high');
    expect(f.status).toBe('open');
  });

  test('finding builder rejects an invalid severity/status', () => {
    expect(() => finding('EXT-1', 't', 'bogus', 'open')).toThrow();
    expect(() => finding('EXT-1', 't', 'high', 'bogus')).toThrow();
  });
});

describe('runDate.toMysqlDatetime', () => {
  test('formats an ISO8601 timestamp as MySQL DATETIME(3)', () => {
    expect(toMysqlDatetime('2026-09-01T02:00:00.000Z')).toBe('2026-09-01 02:00:00.000');
  });

  test('is deterministic for the same input', () => {
    const a = toMysqlDatetime('2026-09-01T02:00:00.123Z');
    const b = toMysqlDatetime('2026-09-01T02:00:00.123Z');
    expect(a).toBe(b);
  });
});
