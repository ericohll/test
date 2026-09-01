// Shared API Gateway proxy-integration handler shell: route matching, body
// parsing/validation, DB connection lifecycle, and error-to-HTTP-status
// mapping, so each api-*.js file only has to define its route logic.

const { withConnection, withTransaction } = require('./db');
const { badRequest, notFound, serverError } = require('./http');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function parseBody(event) {
  const raw = event.body;
  if (raw === undefined || raw === null || raw === '') return {};
  const text = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError('Request body must be valid JSON object');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('Request body must be valid JSON object');
  }
  return parsed;
}

function createApiHandler(routes) {
  return async function handler(event = {}) {
    const resource = event.resource || event.path;
    const key = `${event.httpMethod} ${resource}`;
    const route = routes[key];
    if (!route) return notFound('Not found');

    let body;
    try {
      body = parseBody(event);
    } catch (err) {
      if (err instanceof ValidationError) return badRequest(err.message);
      throw err;
    }

    const req = {
      event,
      pathParams: event.pathParameters || {},
      query: event.queryStringParameters || {},
      body,
    };

    const handle = typeof route === 'function' ? route : route.handle;
    const runner = typeof route === 'function' || !route.tx ? withConnection : withTransaction;

    try {
      return await runner((conn) => handle(req, conn));
    } catch (err) {
      if (err instanceof ValidationError) return badRequest(err.message);
      return serverError(err);
    }
  };
}

function intParam(query, name, { default: def, min, max } = {}) {
  const raw = query ? query[name] : undefined;
  if (raw === undefined || raw === null || raw === '') return def;
  if (!/^-?\d+$/.test(String(raw))) {
    throw new ValidationError(`${name} must be an integer`);
  }
  const value = Number.parseInt(raw, 10);
  if (min !== undefined && value < min) {
    throw new ValidationError(`${name} must be >= ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new ValidationError(`${name} must be <= ${max}`);
  }
  return value;
}

function enumParam(query, name, allowed, { required = false } = {}) {
  const raw = query ? query[name] : undefined;
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new ValidationError(`${name} is required (one of: ${allowed.join(', ')})`);
    return undefined;
  }
  if (!allowed.includes(raw)) {
    throw new ValidationError(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return raw;
}

function requiredString(obj, name, { maxLength } = {}) {
  const raw = obj ? obj[name] : undefined;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ValidationError(`${name} is required`);
  }
  const trimmed = raw.trim();
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new ValidationError(`${name} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function requiredNumber(obj, name) {
  const raw = obj ? obj[name] : undefined;
  if (raw === undefined || raw === null || raw === '') {
    throw new ValidationError(`${name} is required`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${name} must be a number`);
  }
  return value;
}

module.exports = {
  createApiHandler, ValidationError, intParam, enumParam, requiredString, requiredNumber,
};
