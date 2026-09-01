const { findingId, batchKey, s3RawKey } = require('../src/lib/ids');
const { passes, OPERATORS } = require('../src/lib/operators');

describe('ids', () => {
  test('findingId is deterministic for the same inputs', () => {
    const a = findingId('sonarqube', 'proj-1', 'ISSUE-123');
    const b = findingId('sonarqube', 'proj-1', 'ISSUE-123');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('findingId differs when any input differs', () => {
    const base = findingId('sonarqube', 'proj-1', 'ISSUE-123');
    expect(findingId('trivy', 'proj-1', 'ISSUE-123')).not.toBe(base);
    expect(findingId('sonarqube', 'proj-2', 'ISSUE-123')).not.toBe(base);
    expect(findingId('sonarqube', 'proj-1', 'ISSUE-124')).not.toBe(base);
  });

  test('findingId does not collide across a naive concatenation boundary shift', () => {
    // "ab" + "c" must not collide with "a" + "bc" once fields shift.
    const a = findingId('ab', 'c', 'x');
    const b = findingId('a', 'bc', 'x');
    expect(a).not.toBe(b);
  });

  test('batchKey composes tool#project#run_date', () => {
    expect(batchKey('gitlab', 'proj-1', '2026-09-01')).toBe('gitlab#proj-1#2026-09-01');
  });

  test('s3RawKey is partitioned by tool/project/run_date', () => {
    expect(s3RawKey('trivy', 'proj-1', '2026-09-01')).toBe('raw/trivy/proj-1/2026-09-01/data.json');
  });
});

describe('operators', () => {
  test.each([
    ['lt', 5, 10, true], ['lt', 10, 10, false],
    ['lte', 10, 10, true], ['lte', 11, 10, false],
    ['gt', 11, 10, true], ['gt', 10, 10, false],
    ['gte', 10, 10, true], ['gte', 9, 10, false],
    ['eq', 10, 10, true], ['eq', 9, 10, false],
  ])('%s: %d vs %d -> %s', (operator, value, threshold, expected) => {
    expect(passes(value, operator, threshold)).toBe(expected);
  });

  test('rejects unknown operators', () => {
    expect(() => passes(1, 'bogus', 1)).toThrow();
  });

  test('OPERATORS lists exactly the five supported comparisons', () => {
    expect(OPERATORS.sort()).toEqual(['eq', 'gt', 'gte', 'lt', 'lte']);
  });
});
