import { decodeJwtPayload, getGroups, getEmail, isExpiringSoon } from '../lib/jwt.js';
import { initiateAuthRefresh } from './cognito.js';

const REFRESH_KEY = 'qd.refreshToken';
const ID_KEY = 'qd.idToken';
const EMAIL_KEY = 'qd.email';

// In-memory only — the access token never touches localStorage.
let state = {
  idToken: null,
  accessToken: null,
  expiresAt: null,
  email: null,
  groups: [],
};

let refreshInFlight = null;

export function getState() {
  return state;
}

export function saveSession(authResult) {
  const idToken = authResult.IdToken;
  const payload = decodeJwtPayload(idToken);
  const email = getEmail(payload);
  const groups = getGroups(payload);
  const expiresAt = Date.now() + (authResult.ExpiresIn || 0) * 1000;

  state = {
    idToken,
    accessToken: authResult.AccessToken || null,
    expiresAt,
    email,
    groups,
  };

  if (idToken) localStorage.setItem(ID_KEY, idToken);
  if (email) localStorage.setItem(EMAIL_KEY, email);
  // REFRESH_TOKEN_AUTH responses omit a new RefreshToken; keep whichever one
  // is already stored in that case.
  if (authResult.RefreshToken) localStorage.setItem(REFRESH_KEY, authResult.RefreshToken);

  return state;
}

export function clearSession() {
  state = { idToken: null, accessToken: null, expiresAt: null, email: null, groups: [] };
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(ID_KEY);
  localStorage.removeItem(EMAIL_KEY);
}

// Called once at boot. Resolves once the session is known one way or
// another (authenticated from a stored refresh token, or anonymous).
export async function restoreSession() {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) {
    return { status: 'anonymous' };
  }
  try {
    const { AuthenticationResult } = await initiateAuthRefresh(refreshToken);
    saveSession(AuthenticationResult);
    return { status: 'authenticated' };
  } catch {
    clearSession();
    return { status: 'anonymous' };
  }
}

function doRefresh() {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) {
    return Promise.reject(new Error('No refresh token available'));
  }
  refreshInFlight = initiateAuthRefresh(refreshToken)
    .then(({ AuthenticationResult }) => saveSession(AuthenticationResult))
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

// The single function the API client calls before every request. Refreshes
// proactively when the current token is absent or within the skew window,
// de-duplicating concurrent callers behind one shared in-flight promise.
export async function getFreshIdToken({ force = false } = {}) {
  const hasRefreshToken = Boolean(localStorage.getItem(REFRESH_KEY));
  if (!state.idToken && !hasRefreshToken) {
    return null;
  }
  const needsRefresh = force || !state.idToken || isExpiringSoon(state.expiresAt);
  if (needsRefresh) {
    await (refreshInFlight || doRefresh());
  }
  return state.idToken;
}

export function signOut() {
  // Does NOT call GlobalSignOut (see auth/cognito.js) — this only clears the
  // tokens held by this browser.
  clearSession();
  window.location.hash = '#/login';
}

// Mirrors WRITE_GROUPS in src/lib/auth.js (the backend's own group check) so
// the UI's edit-permission gate matches what the API will actually enforce.
const WRITE_GROUPS = ['ReleaseManager', 'QALead'];

export function canEditThresholds(groups) {
  return (groups || []).some((g) => WRITE_GROUPS.includes(g));
}
