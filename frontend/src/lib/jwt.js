// Pure JWT-payload helpers. No signature verification happens here — API
// Gateway's Cognito authorizer verifies the token server-side; the frontend
// only reads claims to render UI (email, groups) and to know when to refresh.

export function decodeJwtPayload(token) {
  try {
    if (typeof token !== 'string' || token.length === 0) return {};
    const parts = token.split('.');
    if (parts.length < 2) return {};
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// cognito:groups can come back as an array, a single string, or a
// bracketed/comma-joined string depending on token type and client config.
export function getGroups(payload) {
  const raw = payload && payload['cognito:groups'];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.length > 0) {
    return raw
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);
  }
  return [];
}

export function getEmail(payload) {
  return (payload && payload.email) || null;
}

export function isExpiringSoon(expiresAt, skewMs = 120000) {
  if (!expiresAt) return true;
  return expiresAt - Date.now() < skewMs;
}
