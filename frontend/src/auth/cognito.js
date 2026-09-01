// Raw Cognito IDP calls. These are unauthenticated JSON-1.1 API operations —
// no request signing, no credentials — so plain fetch is enough and we avoid
// pulling in the AWS SDK / amazon-cognito-identity-js just for six calls.
import config from '../config.js';

const ENDPOINT = () => `https://cognito-idp.${config.region}.amazonaws.com/`;

async function call(operation, payload) {
  let res;
  try {
    res = await fetch(ENDPOINT(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${operation}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    const err = new Error('Could not reach Cognito. Check your connection and try again.');
    err.code = 'NetworkError';
    throw err;
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const code = (body.__type || 'UnknownError').replace(/^.*#/, '');
    const err = new Error(body.message || code);
    err.code = code;
    throw err;
  }

  return body;
}

// GenerateSecret: false on the app client means no SecretHash is ever
// computed or sent for any of these operations.

export function signUp(email, password) {
  return call('SignUp', {
    ClientId: config.userPoolClientId,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: 'email', Value: email }],
  });
}

export function confirmSignUp(email, code) {
  return call('ConfirmSignUp', {
    ClientId: config.userPoolClientId,
    Username: email,
    ConfirmationCode: code,
  });
}

export function resendConfirmationCode(email) {
  return call('ResendConfirmationCode', {
    ClientId: config.userPoolClientId,
    Username: email,
  });
}

export function initiateAuthPassword(email, password) {
  return call('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: config.userPoolClientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
}

export function initiateAuthRefresh(refreshToken) {
  return call('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: config.userPoolClientId,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
}

// Exported for completeness but intentionally unused: session.js's signOut()
// only clears local tokens. Calling GlobalSignOut would require holding the
// access token around solely for logout and would invalidate the refresh
// token on every other open tab/device for this user, which is more than a
// "sign out this browser" action should do for a hackathon prototype.
export function globalSignOut(accessToken) {
  return call('GlobalSignOut', { AccessToken: accessToken });
}
