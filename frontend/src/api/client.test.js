import { describe, it, expect } from 'vitest';
import { buildQuery, authHeaders, normaliseList } from './client.js';

describe('buildQuery', () => {
  it('omits empty filters, keeps offset=0', () => {
    expect(buildQuery({ project_id: 'p1', status: '', severity: undefined, limit: 25, offset: 0 })).toBe(
      '?project_id=p1&limit=25&offset=0',
    );
  });

  it('returns an empty string for no params', () => {
    expect(buildQuery({})).toBe('');
  });

  it('percent-encodes special characters', () => {
    expect(buildQuery({ q: 'a b&c' })).toBe('?q=a%20b%26c');
  });
});

describe('authHeaders', () => {
  it('sends the raw token with no Bearer prefix', () => {
    expect(authHeaders('tok')).toEqual({ Authorization: 'tok' });
  });
});

describe('normaliseList', () => {
  it('returns a bare array as-is', () => {
    expect(normaliseList([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('unwraps { items: [...] }', () => {
    expect(normaliseList({ items: [1, 2] })).toEqual([1, 2]);
  });

  it('unwraps { findings: [...] }', () => {
    expect(normaliseList({ findings: [1] })).toEqual([1]);
  });

  it('returns [] for an object with no recognised list key', () => {
    expect(normaliseList({})).toEqual([]);
  });
});
