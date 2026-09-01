process.env.AWS_REGION = 'ap-southeast-1';

const { mockClient } = require('aws-sdk-client-mock');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretsMock = mockClient(SecretsManagerClient);
let testCounter = 0;

const { handler, formatBreach } = require('../../src/handlers/notify-slack');

beforeEach(() => {
  secretsMock.reset();
  testCounter += 1;
  process.env.SLACK_SECRET_ARN = `arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:slack-${testCounter}`;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
});

afterEach(() => {
  delete global.fetch;
});

afterAll(() => secretsMock.restore());

function snsRecord(payload, subject) {
  return {
    Sns: {
      Subject: subject || 'notification',
      Message: typeof payload === 'string' ? payload : JSON.stringify(payload),
    },
  };
}

function breachPayload(overrides = {}) {
  return {
    type: 'gate_breach',
    project_id: 'proj-1',
    project_name: 'Payments',
    release_id: 'rel-1',
    run_date: '2026-09-01',
    status: 'fail',
    failed_metrics: [
      { metric_type: 'coverage', operator: 'gte', threshold_value: 80, value: 62, tool: 'sonarqube', run_date: '2026-09-01' },
    ],
    dashboard_url: 'https://cdn.example.com/projects/proj-1',
    ...overrides,
  };
}

describe('notify-slack handler', () => {
  test('spec criterion: gate_breach payload posts once with expected text', async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ webhookUrl: 'https://hooks.slack.example/abc' }) });

    const event = { Records: [snsRecord(breachPayload())] };
    const result = await handler(event);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://hooks.slack.example/abc');
    expect(global.fetch.mock.calls[0][1].method).toBe('POST');
    const text = JSON.parse(global.fetch.mock.calls[0][1].body).text;
    expect(text).toContain('Payments');
    expect(text).toContain('coverage');
    expect(text).toContain('FAIL');
    expect(text).toContain('needs gte 80');
    expect(result.delivered).toBe(1);
  });

  test('three records -> fetch called 3x, returns {delivered:3}', async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ webhookUrl: 'https://hooks.slack.example/abc' }) });
    const event = { Records: [snsRecord(breachPayload()), snsRecord(breachPayload()), snsRecord(breachPayload())] };
    const result = await handler(event);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ delivered: 3, skipped: 0 });
  });

  test('non-JSON Sns.Message still posts once, includes Subject, does not throw', async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ webhookUrl: 'https://hooks.slack.example/abc' }) });
    const event = { Records: [snsRecord('plain text alert body', 'Pipeline failure')] };
    const result = await handler(event);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const text = JSON.parse(global.fetch.mock.calls[0][1].body).text;
    expect(text).toContain('Pipeline failure');
    expect(result.delivered).toBe(1);
  });

  test('fetch resolving not-ok rejects the handler', async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ webhookUrl: 'https://hooks.slack.example/abc' }) });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'error' });
    const event = { Records: [snsRecord(breachPayload())] };
    await expect(handler(event)).rejects.toThrow();
  });

  test("webhookUrl === 'REPLACE_ME' skips delivery without throwing", async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ webhookUrl: 'REPLACE_ME' }) });
    const event = { Records: [snsRecord(breachPayload())] };
    const result = await handler(event);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: 1, delivered: 0 });
  });

  test('secret without a webhookUrl key skips delivery without throwing', async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ somethingElse: 'x' }) });
    const event = { Records: [snsRecord(breachPayload())] };
    const result = await handler(event);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ skipped: 1, delivered: 0 });
  });

  test('handler({}) and {Records:[]} resolve to {delivered:0}, no fetch', async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ webhookUrl: 'https://hooks.slack.example/abc' }) });
    const r1 = await handler({});
    expect(r1.delivered).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();

    const r2 = await handler({ Records: [] });
    expect(r2.delivered).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('formatBreach', () => {
  test('missing/empty failed_metrics -> a single explanatory line', () => {
    const text = formatBreach(breachPayload({ failed_metrics: [] }));
    expect(text).toContain('(no metric detail supplied)');
  });
});
