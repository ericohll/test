const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

const ok = (body) => respond(200, body);
const created = (body) => respond(201, body);
const badRequest = (message) => respond(400, { error: message });
const forbidden = (message) => respond(403, { error: message || 'Forbidden' });
const notFound = (message) => respond(404, { error: message || 'Not found' });
const serverError = (err) => {
  console.error(err);
  return respond(500, { error: 'Internal server error' });
};

module.exports = { ok, created, badRequest, forbidden, notFound, serverError };
