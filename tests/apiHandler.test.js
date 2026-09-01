const { createApiHandler, ValidationError, intParam, enumParam, requiredString, requiredNumber } = require('../src/lib/apiHandler');

let mockConn;
let mockWithConnection;
let mockWithTransaction;

jest.mock('../src/lib/db', () => ({
  withConnection: (fn) => mockWithConnection(fn),
  withTransaction: (fn) => mockWithTransaction(fn),
}));

beforeEach(() => {
  mockConn = { tag: 'conn' };
  mockWithConnection = jest.fn((fn) => fn(mockConn));
  mockWithTransaction = jest.fn((fn) => fn(mockConn));
});

function baseEvent(overrides = {}) {
  return {
    httpMethod: 'GET',
    resource: '/widgets',
    path: '/widgets',
    pathParameters: null,
    queryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    requestContext: {},
    ...overrides,
  };
}

describe('createApiHandler routing', () => {
  test('routes match on METHOD + resource and receive (req, conn)', async () => {
    const route = jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' });
    const handler = createApiHandler({ 'GET /widgets': route });
    await handler(baseEvent());
    expect(route).toHaveBeenCalledTimes(1);
    const [req, conn] = route.mock.calls[0];
    expect(conn).toBe(mockConn);
    expect(req.body).toEqual({});
  });

  test('method mismatch on a known resource -> 404', async () => {
    const route = jest.fn();
    const handler = createApiHandler({ 'GET /widgets': route });
    const res = await handler(baseEvent({ httpMethod: 'POST' }));
    expect(res.statusCode).toBe(404);
    expect(route).not.toHaveBeenCalled();
  });

  test('unknown resource -> 404', async () => {
    const handler = createApiHandler({ 'GET /widgets': jest.fn() });
    const res = await handler(baseEvent({ resource: '/nope' }));
    expect(res.statusCode).toBe(404);
  });

  test('falls back to event.path when resource is absent', async () => {
    const route = jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' });
    const handler = createApiHandler({ 'GET /widgets': route });
    const event = baseEvent();
    delete event.resource;
    await handler(event);
    expect(route).toHaveBeenCalledTimes(1);
  });

  test('malformed JSON body -> 400, route never called, no connection opened', async () => {
    const route = jest.fn();
    const handler = createApiHandler({ 'GET /widgets': route });
    const res = await handler(baseEvent({ httpMethod: 'GET', body: '{not json' }));
    expect(res.statusCode).toBe(400);
    expect(route).not.toHaveBeenCalled();
    expect(mockWithConnection).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  test('array JSON body -> 400', async () => {
    const handler = createApiHandler({ 'GET /widgets': jest.fn() });
    const res = await handler(baseEvent({ body: '[1,2,3]' }));
    expect(res.statusCode).toBe(400);
  });

  test('scalar JSON body -> 400', async () => {
    const handler = createApiHandler({ 'GET /widgets': jest.fn() });
    const res = await handler(baseEvent({ body: '"hello"' }));
    expect(res.statusCode).toBe(400);
  });

  test('absent body -> req.body === {}', async () => {
    const route = jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' });
    const handler = createApiHandler({ 'GET /widgets': route });
    await handler(baseEvent({ body: null }));
    expect(route.mock.calls[0][0].body).toEqual({});
  });

  test('base64-encoded body is decoded before parsing', async () => {
    const route = jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' });
    const handler = createApiHandler({ 'GET /widgets': route });
    const payload = JSON.stringify({ hello: 'world' });
    await handler(baseEvent({ body: Buffer.from(payload).toString('base64'), isBase64Encoded: true }));
    expect(route.mock.calls[0][0].body).toEqual({ hello: 'world' });
  });

  test('a thrown ValidationError maps to 400 with its message', async () => {
    const route = jest.fn().mockImplementation(() => { throw new ValidationError('bad field'); });
    const handler = createApiHandler({ 'GET /widgets': route });
    const res = await handler(baseEvent());
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('bad field');
  });

  test('any other thrown error maps to 500', async () => {
    const route = jest.fn().mockImplementation(() => { throw new Error('boom'); });
    const handler = createApiHandler({ 'GET /widgets': route });
    const res = await handler(baseEvent());
    expect(res.statusCode).toBe(500);
  });

  test('tx:true routes go through withTransaction; plain routes go through withConnection', async () => {
    const plain = jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' });
    const tx = jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' });
    const handler = createApiHandler({
      'GET /widgets': plain,
      'PUT /widgets': { handle: tx, tx: true },
    });
    await handler(baseEvent());
    expect(mockWithConnection).toHaveBeenCalledTimes(1);
    expect(mockWithTransaction).not.toHaveBeenCalled();

    await handler(baseEvent({ httpMethod: 'PUT' }));
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('intParam', () => {
  test('returns the default when absent', () => {
    expect(intParam({}, 'top', { default: 20, min: 1, max: 100 })).toBe(20);
  });
  test('parses a valid integer string', () => {
    expect(intParam({ top: '5' }, 'top', { default: 20, min: 1, max: 100 })).toBe(5);
  });
  test('rejects a non-integer string', () => {
    expect(() => intParam({ top: 'abc' }, 'top', { default: 20 })).toThrow(ValidationError);
  });
  test('rejects out-of-range values without clamping', () => {
    expect(() => intParam({ top: '0' }, 'top', { default: 20, min: 1, max: 100 })).toThrow(ValidationError);
    expect(() => intParam({ top: '101' }, 'top', { default: 20, min: 1, max: 100 })).toThrow(ValidationError);
  });
});

describe('enumParam', () => {
  test('returns undefined when absent and not required', () => {
    expect(enumParam({}, 'status', ['open', 'closed'])).toBeUndefined();
  });
  test('returns the value when valid', () => {
    expect(enumParam({ status: 'open' }, 'status', ['open', 'closed'])).toBe('open');
  });
  test('throws ValidationError listing the allowed values', () => {
    expect(() => enumParam({ status: 'bogus' }, 'status', ['open', 'closed'])).toThrow(ValidationError);
  });
  test('required: true and absent throws', () => {
    expect(() => enumParam({}, 'status', ['open', 'closed'], { required: true })).toThrow(ValidationError);
  });
});

describe('requiredString', () => {
  test('trims and returns a string', () => {
    expect(requiredString({ name: '  hi  ' }, 'name', {})).toBe('hi');
  });
  test('throws when missing', () => {
    expect(() => requiredString({}, 'name', {})).toThrow(ValidationError);
  });
  test('throws when exceeding maxLength', () => {
    expect(() => requiredString({ name: 'x'.repeat(10) }, 'name', { maxLength: 5 })).toThrow(ValidationError);
  });
});

describe('requiredNumber', () => {
  test('accepts a numeric string', () => {
    expect(requiredNumber({ value: '80' }, 'value')).toBe(80);
  });
  test('accepts a real number', () => {
    expect(requiredNumber({ value: 80 }, 'value')).toBe(80);
  });
  test('throws on a non-numeric value', () => {
    expect(() => requiredNumber({ value: 'abc' }, 'value')).toThrow(ValidationError);
  });
  test('throws when missing', () => {
    expect(() => requiredNumber({}, 'value')).toThrow(ValidationError);
  });
});
