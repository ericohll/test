// Builds API Gateway proxy-integration events for handler tests, matching the
// shapes src/lib/apiHandler.js and src/lib/auth.js expect.

function apiEvent({ method = 'GET', resource, pathParameters, query, body, claims, headers } = {}) {
  return {
    httpMethod: method,
    resource,
    path: resource,
    pathParameters: pathParameters || null,
    queryStringParameters: query || null,
    headers: headers || {},
    body: body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body)),
    isBase64Encoded: false,
    requestContext: claims ? { authorizer: { claims } } : {},
  };
}

// `groups` may be an array (Cognito's native shape) or a comma-delimited
// string (how some clients / API Gateway mapping templates flatten it) --
// src/lib/auth.js#getIdentity must accept both.
function claimsFor({ sub = 'user-1', email = 'user@example.com', groups } = {}) {
  const claims = { sub, email };
  if (groups !== undefined) {
    claims['cognito:groups'] = groups;
  }
  return claims;
}

// For the API-key-protected /releases/{id}/gate-check route: no Cognito
// authorizer context at all, just an API key header.
function noAuthEvent({ method = 'GET', resource, pathParameters, query, body, headers } = {}) {
  return {
    httpMethod: method,
    resource,
    path: resource,
    pathParameters: pathParameters || null,
    queryStringParameters: query || null,
    headers: { 'x-api-key': 'test-key', ...(headers || {}) },
    body: body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body)),
    isBase64Encoded: false,
    requestContext: {},
  };
}

module.exports = { apiEvent, claimsFor, noAuthEvent };
