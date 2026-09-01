const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { createFakeDb } = require('../helpers/fakeDb');
const { batchKey, s3RawKey } = require('../../src/lib/ids');

jest.mock('../../src/lib/db');
const db = require('../../src/lib/db');

const s3Mock = mockClient(S3Client);

const ORIGINAL_ENV = { ...process.env };

const TOOLS = [
  {
    tool: 'sonarqube',
    handlerPath: '../../src/handlers/normalize-sonarqube',
    fixture: require('../fixtures/sonarqube.json'),
    projectId: 'checkout-svc',
    metricsCount: 6,
    findingsCount: 4,
  },
  {
    tool: 'gitlab',
    handlerPath: '../../src/handlers/normalize-gitlab',
    fixture: require('../fixtures/gitlab.json'),
    projectId: 'checkout-svc',
    metricsCount: 6,
    findingsCount: 4,
  },
  {
    tool: 'fortify',
    handlerPath: '../../src/handlers/normalize-fortify',
    fixture: require('../fixtures/fortify.json'),
    projectId: 'payments-api',
    metricsCount: 6,
    findingsCount: 4,
  },
  {
    tool: 'trivy',
    handlerPath: '../../src/handlers/normalize-trivy',
    fixture: require('../fixtures/trivy.json'),
    projectId: 'payments-api',
    metricsCount: 6,
    findingsCount: 4,
  },
  {
    tool: 'tricentis',
    handlerPath: '../../src/handlers/normalize-tricentis',
    fixture: require('../fixtures/tricentis.json'),
    projectId: 'payments-api',
    metricsCount: 6,
    findingsCount: 5,
  },
];

function sqsEvent({ tool, projectId, runDate, envelope }) {
  const bk = batchKey(tool, projectId, runDate);
  const key = s3RawKey(tool, projectId, runDate);
  s3Mock.on(GetObjectCommand, { Bucket: 'test-datalake', Key: key }).resolves({
    Body: { transformToString: async () => JSON.stringify(envelope) },
  });
  return {
    Records: [{
      body: JSON.stringify({
        tool, project_id: projectId, project_name: `${projectId} display name`, repo_url: null,
        run_date: runDate, s3_key: key, batch_key: bk,
      }),
    }],
  };
}

describe('normalize handlers (all five tools)', () => {
  let conn;

  beforeEach(() => {
    s3Mock.reset();
    conn = createFakeDb();
    db.withConnection.mockImplementation((fn) => fn(conn));
    db.withTransaction.mockImplementation((fn) => fn(conn));
    process.env = { ...ORIGINAL_ENV, DATA_LAKE_BUCKET: 'test-datalake' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.clearAllMocks();
  });

  test.each(TOOLS)('$tool: first run creates project, release, metrics, findings, and "created" lifecycle events', async ({ tool, handlerPath, fixture, projectId, metricsCount, findingsCount }) => {
    process.env.TOOL = tool;
    const event = sqsEvent({ tool, projectId, runDate: '2026-09-01', envelope: fixture });
    const { handler } = require(handlerPath);

    await handler(event);

    expect(conn._tables.projects.size).toBe(1);
    expect(conn._tables.releases.size).toBe(1);
    const bk = batchKey(tool, projectId, '2026-09-01');
    expect(conn._tables.ingestion_batches.get(bk).status).toBe('normalized');
    expect(conn._tables.metrics.size).toBe(metricsCount);
    expect(conn._tables.findings.size).toBe(findingsCount);
    expect(conn._tables.finding_lifecycle_events).toHaveLength(findingsCount);
    expect(conn._tables.finding_lifecycle_events.every((e) => e.event_type === 'created')).toBe(true);
  });

  test.each(TOOLS)('$tool: replaying the identical event is idempotent (no duplicate rows/events)', async ({ tool, handlerPath, fixture, projectId, metricsCount, findingsCount }) => {
    process.env.TOOL = tool;
    const event = sqsEvent({ tool, projectId, runDate: '2026-09-01', envelope: fixture });
    const { handler } = require(handlerPath);

    await handler(event);
    await handler(event);

    expect(conn._tables.metrics.size).toBe(metricsCount);
    expect(conn._tables.findings.size).toBe(findingsCount);
    expect(conn._tables.releases.size).toBe(1);
    expect(conn._tables.finding_lifecycle_events).toHaveLength(findingsCount);
    const bk = batchKey(tool, projectId, '2026-09-01');
    const batch = conn._tables.ingestion_batches.get(bk);
    expect(batch.attempt_count).toBe(2);
    expect(batch.status).toBe('normalized');
  });

  test.each(TOOLS)('$tool: a later run_date doubles metrics but leaves findings/lifecycle-event-per-finding semantics intact', async ({ tool, handlerPath, fixture, projectId, metricsCount, findingsCount }) => {
    process.env.TOOL = tool;
    const { handler } = require(handlerPath);

    await handler(sqsEvent({ tool, projectId, runDate: '2026-09-01', envelope: fixture }));
    await handler(sqsEvent({ tool, projectId, runDate: '2026-09-02', envelope: fixture }));

    expect(conn._tables.metrics.size).toBe(metricsCount * 2);
    expect(conn._tables.findings.size).toBe(findingsCount);
    // Same severity/status on the second run -> exactly one extra 'seen' event per finding.
    expect(conn._tables.finding_lifecycle_events).toHaveLength(findingsCount * 2);
  });

  test.each(TOOLS)('$tool: an S3 fetch failure marks the batch failed with an error message and rejects the handler', async ({ tool, handlerPath, fixture, projectId }) => {
    process.env.TOOL = tool;
    const runDate = '2026-09-01';
    const bk = batchKey(tool, projectId, runDate);
    const key = s3RawKey(tool, projectId, runDate);
    s3Mock.on(GetObjectCommand, { Bucket: 'test-datalake', Key: key }).rejects(new Error('s3 unavailable'));
    const event = {
      Records: [{
        body: JSON.stringify({
          tool, project_id: projectId, project_name: 'x', run_date: runDate, s3_key: key, batch_key: bk,
        }),
      }],
    };
    const { handler } = require(handlerPath);

    await expect(handler(event)).rejects.toThrow();

    const batch = conn._tables.ingestion_batches.get(bk);
    expect(batch.status).toBe('failed');
    expect(batch.error_message).toBe('s3 unavailable');
  });

  test('a record whose body.tool differs from the handler TOOL is skipped with zero DB writes', async () => {
    process.env.TOOL = 'sonarqube';
    const event = sqsEvent({ tool: 'gitlab', projectId: 'checkout-svc', runDate: '2026-09-01', envelope: require('../fixtures/gitlab.json') });
    const { handler } = require('../../src/handlers/normalize-sonarqube');

    await handler(event);

    expect(conn._tables.projects.size).toBe(0);
    expect(conn._tables.metrics.size).toBe(0);
    expect(conn._tables.findings.size).toBe(0);
  });
});
