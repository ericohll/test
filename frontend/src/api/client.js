// API Gateway's COGNITO_USER_POOLS authorizer expects the bare token value
// in the Authorization header — no "Bearer " prefix. It must be the ID
// token, not the access token: src/lib/auth.js (the backend) reads
// claims.email from event.requestContext.authorizer.claims, and email only
// appears on the ID token.
import config from '../config.js';
import { getFreshIdToken, clearSession } from '../auth/session.js';

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function buildQuery(params = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export function authHeaders(token) {
  return { Authorization: token };
}

// Returns payload as-is if already an array; otherwise looks for the first
// array found among a set of commonly-used envelope keys, plus any
// caller-supplied preferred keys; otherwise []. The backend's exact response
// shapes aren't pinned yet, so every list-returning endpoint goes through
// this instead of assuming a specific envelope.
export function normaliseList(payload, ...preferredKeys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const keys = ['items', 'findings', 'projects', 'data', 'results', ...preferredKeys];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

// Reads the first present key from `keys` off `obj` (e.g. project_id vs id),
// falling back to `fallback` when none are present.
export function pickFirst(obj, keys, fallback) {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
}

function pickErrorMessage(parsed, fallback) {
  if (parsed && typeof parsed === 'object') {
    // src/lib/http.js emits { error: message } on the backend.
    if (parsed.error) return parsed.error;
    if (parsed.message) return parsed.message;
  }
  if (typeof parsed === 'string' && parsed) return parsed;
  return fallback;
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function request(method, path, { query, body } = {}) {
  const url = `${config.apiUrl}${path}${buildQuery(query)}`;

  const doRequest = (token) => {
    const headers = { ...authHeaders(token) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  const token = await getFreshIdToken();
  if (!token) {
    throw new ApiError(401, 'You are not signed in.', null);
  }

  let res;
  try {
    res = await doRequest(token);
  } catch {
    // A fetch rejection (TypeError) means we couldn't reach the API at all.
    // Known contract gap: API Gateway's DEFAULT_4XX gateway responses lack
    // CORS headers, so an authorizer rejection can *look* like a network
    // error in the browser rather than a readable 401 (see README "Known
    // contract gaps"). Since a session exists, try one forced refresh and
    // retry before giving up.
    try {
      const freshToken = await getFreshIdToken({ force: true });
      res = await doRequest(freshToken);
    } catch {
      throw new ApiError(
        0,
        'Could not reach the API. Your session may have expired, or the API URL is wrong.',
        null,
      );
    }
  }

  if (res.status === 401) {
    let retried;
    try {
      const freshToken = await getFreshIdToken({ force: true });
      retried = await doRequest(freshToken);
    } catch {
      retried = null;
    }
    if (!retried || retried.status === 401) {
      clearSession();
      window.location.hash = '#/login';
      throw new ApiError(401, 'Your session has expired. Please sign in again.', null);
    }
    res = retried;
  }

  if (res.status === 403) {
    const parsed = await parseBody(res);
    throw new ApiError(403, pickErrorMessage(parsed, 'You do not have permission to do that.'), parsed);
  }

  if (res.status === 204) return null;

  const parsed = await parseBody(res);

  if (!res.ok) {
    throw new ApiError(res.status, pickErrorMessage(parsed, `Request failed with status ${res.status}`), parsed);
  }

  return parsed;
}

export const get = (path, query) => request('GET', path, { query });
export const post = (path, body) => request('POST', path, { body });
export const put = (path, body) => request('PUT', path, { body });
