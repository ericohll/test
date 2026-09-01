const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { s3RawKey, batchKey } = require('../../src/lib/ids');
const { today } = require('../../src/lib/runDate');

jest.mock('../../src/lib/secrets');
const { getSecretJson } = require('../../src/lib/secrets');

const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

function jsonResponse(data) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => data };
}

// Dispatches on distinctive URL substrings shared by both the sonarqube and
// gitlab sources. `failMarkers` lets a test simulate one project's HTTP
// calls failing while others succeed.
function makeFetchMock(failMarkers = []) {
  return jest.fn(async (url) => {
    for (const marker of failMarkers) {
      if (url.includes(marker)) throw new Error(`simulated network failure for ${marker}`);
    }
    if (url.includes('/api/measures/component')) {
      return jsonResponse({ component: { key: 'x', measures: [{ metric: 'coverage', value: '80' }] } });
    }
    if (url.includes('/api/issues/search')) {
      return jsonResponse({ issues: [] });
    }
    if (url.includes('/merge_requests')) return jsonResponse([]);
    if (url.includes('/pipelines')) return jsonResponse([]);
    if (url.includes('/vulnerability_findings')) return jsonResponse([]);
    if (/\/api\/v4\/projects\/\d+(\?.*)?$/.test(url)) {
      return jsonResponse({ id: 1, name: 'GitLab Project', web_url: 'https://gitlab.example.com/x' });
    }
    throw new Error(`unmocked url in test: ${url}`);
  });
}

const ORIGINAL_ENV = { ...process.env };

describe('ingest API handlers (sonarqube, gitlab)', () => {
  beforeEach(() => {
    s3Mock.reset();
    sqsMock.reset();
    process.env = {
      ...ORIGINAL_ENV,
      DATA_LAKE_BUCKET: 'test-datalake',
      INGEST_QUEUE_URL: 'https://sqs.test.example/queue',
      TOOL_SECRET_ARN: 'arn:aws:secretsmanager:ap-southeast-1:111111111111:secret:test',
    };
    global.fetch = makeFetchMock();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    delete global.fetch;
    jest.clearAllMocks();
  });

  const cases = [
    {
      tool: 'sonarqube',
      handlerPath: '../../src/handlers/ingest-api-sonarqube',
      project: { project_id: 'checkout-svc', name: 'Checkout Service', sonarProjectKey: 'checkout-svc' },
      secret: { token: 'tok', baseUrl: 'https://sonar.example.com' },
    },
    {
      tool: 'gitlab',
      handlerPath: '../../src/handlers/ingest-api-gitlab',
      project: { project_id: 'checkout-svc', name: 'Checkout Service', gitlabProjectId: 1 },
      secret: { token: 'tok', baseUrl: 'https://gitlab.example.com' },
    },
  ];

  test.each(cases)('$tool: writes one S3 envelope and one SQS message per configured project', async ({ tool, handlerPath, project, secret }) => {
    process.env.TOOL = tool;
    getSecretJson.mockResolvedValue({ ...secret, projects: [project] });
    const { handler } = require(handlerPath);

    await handler({});

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    const expectedKey = s3RawKey(tool, 'checkout-svc', today());
    expect(puts[0].args[0].input.Key).toBe(expectedKey);
    expect(puts[0].args[0].input.Bucket).toBe('test-datalake');

    const envelope = JSON.parse(puts[0].args[0].input.Body);
    expect(envelope.envelope_version).toBe(1);
    expect(envelope.tool).toBe(tool);
    expect(envelope.project_id).toBe('checkout-svc');
    expect(envelope.run_date).toBe(today());
    expect(typeof envelope.fetched_at).toBe('string');
    expect(envelope.payload).toBeDefined();

    const sends = sqsMock.commandCalls(SendMessageCommand);
    expect(sends).toHaveLength(1);
    const body = JSON.parse(sends[0].args[0].input.MessageBody);
    expect(body.tool).toBe(tool);
    expect(body.project_id).toBe('checkout-svc');
    expect(body.run_date).toBe(today());
    expect(body.s3_key).toBe(expectedKey);
    expect(body.batch_key).toBe(batchKey(tool, 'checkout-svc', today()));
    // gitlab's fetchProject prefers the live API's project name over the secret's;
    // sonarqube has no equivalent API field, so it keeps the secret's project name.
    expect(body.project_name).toBe(tool === 'gitlab' ? 'GitLab Project' : 'Checkout Service');
  });

  test.each(cases)('$tool: a placeholder (unconfigured) secret makes zero S3/SQS calls and resolves', async ({ tool, handlerPath }) => {
    process.env.TOOL = tool;
    getSecretJson.mockResolvedValue({ token: 'REPLACE_ME', baseUrl: 'REPLACE_ME' });
    const { handler } = require(handlerPath);

    const result = await handler({});

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(result.skipped).toBe('not configured');
  });

  test.each(cases)('$tool: one of two projects failing still publishes the other and reports failed:1, without throwing', async ({ tool, handlerPath, secret }) => {
    process.env.TOOL = tool;
    const projectA = tool === 'sonarqube'
      ? { project_id: 'checkout-svc', name: 'Checkout Service', sonarProjectKey: 'checkout-svc' }
      : { project_id: 'checkout-svc', name: 'Checkout Service', gitlabProjectId: 101 };
    const projectB = tool === 'sonarqube'
      ? { project_id: 'payments-api', name: 'Payments API', sonarProjectKey: 'payments-api' }
      : { project_id: 'payments-api', name: 'Payments API', gitlabProjectId: 202 };
    const failMarker = tool === 'sonarqube' ? 'payments-api' : '/projects/202';

    getSecretJson.mockResolvedValue({ ...secret, projects: [projectA, projectB] });
    global.fetch = makeFetchMock([failMarker]);
    const { handler } = require(handlerPath);

    const result = await handler({});

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
    expect(result.failed).toBe(1);
    expect(result.ingested).toBe(1);
  });

  test.each(cases)('$tool: all projects failing rejects the handler', async ({ tool, handlerPath, secret }) => {
    process.env.TOOL = tool;
    const project = tool === 'sonarqube'
      ? { project_id: 'checkout-svc', name: 'Checkout Service', sonarProjectKey: 'checkout-svc' }
      : { project_id: 'checkout-svc', name: 'Checkout Service', gitlabProjectId: 1 };

    getSecretJson.mockResolvedValue({ ...secret, projects: [project] });
    global.fetch = jest.fn(async () => { throw new Error('total outage'); });
    const { handler } = require(handlerPath);

    await expect(handler({})).rejects.toThrow();
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});
