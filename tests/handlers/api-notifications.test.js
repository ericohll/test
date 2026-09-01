process.env.AWS_REGION = 'ap-southeast-1';
process.env.ALERTS_TOPIC_ARN = 'arn:aws:sns:ap-southeast-1:123456789012:app-79dad50c-0e543650-alerts';

const { mockClient } = require('aws-sdk-client-mock');
const { SNSClient, SubscribeCommand } = require('@aws-sdk/client-sns');

let mockConn;
jest.mock('../../src/lib/db', () => ({
  withConnection: (fn) => fn(mockConn),
  withTransaction: (fn) => fn(mockConn),
}));

const { createFakeDb } = require('../helpers/fakeDb');
const { apiEvent, claimsFor } = require('../helpers/apiEvent');
const { seedProject } = require('../helpers/seed');
const { handler } = require('../../src/handlers/api-notifications');

const snsMock = mockClient(SNSClient);

beforeEach(() => {
  mockConn = createFakeDb();
  snsMock.reset();
  snsMock.on(SubscribeCommand).resolves({ SubscriptionArn: 'pending confirmation' });
});
afterAll(() => snsMock.restore());

function subEvent({ claims, body } = {}) {
  return apiEvent({
    method: 'POST',
    resource: '/notifications/subscriptions',
    claims,
    body: body === undefined ? { project_id: 'proj-1' } : body,
  });
}

describe('POST /notifications/subscriptions', () => {
  test('happy path: self-subscribes to own email, SubscribeCommand shape, audit logged', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const claims = claimsFor({ email: 'me@example.com' });
    const res = await handler(subEvent({ claims }));
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.project_id).toBe('proj-1');
    expect(body.email).toBe('me@example.com');
    expect(body.subscription_arn).toBe('pending confirmation');

    const calls = snsMock.commandCalls(SubscribeCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TopicArn).toBe(process.env.ALERTS_TOPIC_ARN);
    expect(input.Protocol).toBe('email');
    expect(input.Endpoint).toBe('me@example.com');
    expect(JSON.parse(input.Attributes.FilterPolicy)).toEqual({ project_id: ['proj-1'] });
    expect(input.Attributes.FilterPolicyScope).toBe('MessageAttributes');

    expect(mockConn._tables.user_actions).toHaveLength(1);
    const audit = mockConn._tables.user_actions[0];
    expect(audit.action_type).toBe('notification_subscribe');
    expect(audit.target_ref).toBe('project:proj-1');
    expect(audit.detail.email).toBe('me@example.com');
  });

  test('explicit body.email matching the caller is allowed', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const claims = claimsFor({ email: 'me@example.com' });
    const res = await handler(subEvent({ claims, body: { project_id: 'proj-1', email: 'me@example.com' } }));
    expect(res.statusCode).toBe(201);
  });

  test('self-subscribe-only: body.email for a different address -> 403, no SNS call', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const claims = claimsFor({ email: 'me@example.com' });
    const res = await handler(subEvent({ claims, body: { project_id: 'proj-1', email: 'someone-else@example.com' } }));
    expect(res.statusCode).toBe(403);
    expect(snsMock.commandCalls(SubscribeCommand)).toHaveLength(0);
    expect(mockConn._tables.user_actions).toHaveLength(0);
  });

  test('missing project_id -> 400', async () => {
    const claims = claimsFor({ email: 'me@example.com' });
    const res = await handler(subEvent({ claims, body: {} }));
    expect(res.statusCode).toBe(400);
  });

  test('no email on claims and none in body -> 400, no SNS call', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const claims = claimsFor({ email: undefined });
    delete claims.email;
    const res = await handler(subEvent({ claims }));
    expect(res.statusCode).toBe(400);
    expect(snsMock.commandCalls(SubscribeCommand)).toHaveLength(0);
  });

  test('unknown project_id -> 404, no SNS call', async () => {
    const claims = claimsFor({ email: 'me@example.com' });
    const res = await handler(subEvent({ claims, body: { project_id: 'does-not-exist' } }));
    expect(res.statusCode).toBe(404);
    expect(snsMock.commandCalls(SubscribeCommand)).toHaveLength(0);
  });

  test('malformed JSON body -> 400', async () => {
    const claims = claimsFor({ email: 'me@example.com' });
    const res = await handler(subEvent({ claims, body: '{not json' }));
    expect(res.statusCode).toBe(400);
  });
});
