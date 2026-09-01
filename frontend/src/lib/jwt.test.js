import { describe, it, expect } from 'vitest';
import { decodeJwtPayload, getGroups, getEmail, isExpiringSoon } from './jwt.js';
import { canEditThresholds } from '../auth/session.js';

function base64url(input) {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeToken(payload) {
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  // Signature segment is irrelevant to decodeJwtPayload; include one anyway
  // to make sure the '-'/'_' base64url alphabet round-trips correctly.
  return `${header}.${body}.sig-with_dashes`;
}

describe('decodeJwtPayload', () => {
  it('decodes a hand-constructed base64url token, including -/_ chars and non-ASCII claims', () => {
    const payload = { email: 'josé@example.com', sub: 'abc-123_def', 'cognito:groups': ['ReleaseManager'] };
    const token = makeToken(payload);
    expect(decodeJwtPayload(token)).toEqual(payload);
  });

  it('returns {} rather than throwing for malformed input', () => {
    expect(decodeJwtPayload('not.a.jwt')).toEqual({});
    expect(decodeJwtPayload(undefined)).toEqual({});
  });
});

describe('getGroups', () => {
  it('handles array claims', () => {
    expect(getGroups({ 'cognito:groups': ['ReleaseManager'] })).toEqual(['ReleaseManager']);
  });

  it('handles a bare string claim', () => {
    expect(getGroups({ 'cognito:groups': 'ReleaseManager' })).toEqual(['ReleaseManager']);
  });

  it('handles a bracketed comma-joined string claim', () => {
    expect(getGroups({ 'cognito:groups': '[ReleaseManager, QALead]' })).toEqual(['ReleaseManager', 'QALead']);
  });

  it('returns [] when the claim is absent', () => {
    expect(getGroups({})).toEqual([]);
  });
});

describe('getEmail', () => {
  it('reads the email claim', () => {
    expect(getEmail({ email: 'a@b.com' })).toBe('a@b.com');
  });

  it('returns null when absent', () => {
    expect(getEmail({})).toBeNull();
  });
});

describe('canEditThresholds', () => {
  it('is true for ReleaseManager or QALead', () => {
    expect(canEditThresholds(['ReleaseManager'])).toBe(true);
    expect(canEditThresholds(['QALead'])).toBe(true);
  });

  it('is false for Viewer-only or no groups', () => {
    expect(canEditThresholds(['Viewer'])).toBe(false);
    expect(canEditThresholds([])).toBe(false);
  });
});

describe('isExpiringSoon', () => {
  it('is true within the skew window', () => {
    expect(isExpiringSoon(Date.now() + 60000, 120000)).toBe(true);
  });

  it('is false outside the skew window', () => {
    expect(isExpiringSoon(Date.now() + 300000, 120000)).toBe(false);
  });
});
