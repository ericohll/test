process.env.AWS_REGION = 'ap-southeast-1';
process.env.ALERTS_TOPIC_ARN = 'arn:aws:sns:ap-southeast-1:123456789012:app-79dad50c-0e543650-alerts';
process.env.APP_URL = 'https://cdn.example.com';

const { mockClient } = require('aws-sdk-client-mock');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

let mockConn;
jest.mock('../../src/lib/db', () => ({
  withConnection: (fn) => fn(mockConn),
  withTransaction: (fn) => fn(mockConn),
}));

const { createFakeDb } = require('../helpers/fakeDb');
const { seedProject, seedThreshold, seedMetric } = require('../helpers/seed');
const { today } = require('../../src/lib/runDate');

const snsMock = mockClient(SNSClient);

beforeEach(() => {
  mockConn = createFakeDb();
  snsMock.reset();
  snsMock.on(PublishCommand).resolves({ MessageId: 'm-1' });
});
afterAll(() => snsMock.restore());

function loadHandler() {
  return require('../../src/handlers/gate-eval');
}

describe('gate-eval handler', () => {
  test('spec criterion: breach publishes exactly once with the correct shape', async () => {
    const { handler } = loadHandler();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedThreshold(mockConn, { project_id: 'proj-1', metric_type: 'critical_findings', operator: 'lte', threshold_value: 5 });
    await seedMetric(mockConn, { project_id: 'proj-1', tool: 'trivy', metric_type: 'critical_findings', value: 9 });

    const summary = await handler({});

    const calls = snsMock.commandCalls(PublishCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TopicArn).toBe(process.env.ALERTS_TOPIC_ARN);
    expect(input.MessageAttributes.project_id).toEqual({ DataType: 'String', StringValue: 'proj-1' });
    const message = JSON.parse(input.Message);
    expect(message.type).toBe('gate_breach');
    expect(message.status).toBe('fail');
    expect(message.failed_metrics[0]).toMatchObject({
      metric_type: 'critical_findings', operator: 'lte', threshold_value: 5, value: 9,
    });
    expect(input.Subject.length).toBeLessThanOrEqual(100);
    expect(input.Subject).toContain('proj-1');

    const gateRow = [...mockConn._tables.gate_results.values()][0];
    expect(gateRow.status).toBe('fail');
    expect(gateRow.failed_metrics).toHaveLength(1);

    expect(summary.run_date).toBe(today());
  });

  test('gte direction: coverage=62 vs gte 80 fails and publishes', async () => {
    const { handler } = loadHandler();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedThreshold(mockConn, { project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 80 });
    await seedMetric(mockConn, { project_id: 'proj-1', tool: 'sonarqube', metric_type: 'coverage', value: 62 });

    await handler({});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
  });

  test('passing metric: status pass, zero publishes', async () => {
    const { handler } = loadHandler();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedThreshold(mockConn, { project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 80 });
    await seedMetric(mockConn, { project_id: 'proj-1', tool: 'sonarqube', metric_type: 'coverage', value: 91 });

    const summary = await handler({});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    expect(summary.results[0].status).toBe('pass');
  });

  test('no thresholds configured: unknown, no publish, gate_results row still written', async () => {
    const { handler } = loadHandler();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedMetric(mockConn, { project_id: 'proj-1', tool: 'sonarqube', metric_type: 'coverage', value: 91 });

    const summary = await handler({});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    expect(summary.results[0].status).toBe('unknown');
    expect(mockConn._tables.gate_results.size).toBe(1);
  });

  test('threshold with no matching metric: unknown, no publish', async () => {
    const { handler } = loadHandler();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedThreshold(mockConn, { project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 80 });

    const summary = await handler({});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    expect(summary.results[0].status).toBe('unknown');
  });

  test('two projects, one failing one passing: 2 gate_results rows, exactly 1 publish for the failing project', async () => {
    const { handler } = loadHandler();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedThreshold(mockConn, { project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 80 });
    await seedMetric(mockConn, { project_id: 'proj-1', tool: 'sonarqube', metric_type: 'coverage', value: 62 });

    await seedProject(mockConn, { project_id: 'proj-2', name: 'Beta' });
    await seedThreshold(mockConn, { project_id: 'proj-2', metric_type: 'coverage', operator: 'gte', threshold_value: 80 });
    await seedMetric(mockConn, { project_id: 'proj-2', tool: 'sonarqube', metric_type: 'coverage', value: 91 });

    await handler({});
    expect(mockConn._tables.gate_results.size).toBe(2);
    const calls = snsMock.commandCalls(PublishCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.MessageAttributes.project_id.StringValue).toBe('proj-1');
  });

  test('handler(), handler({}), handler({arbitrary}) behave identically', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const { handler } = loadHandler();
    const s1 = await handler();
    expect(s1.run_date).toBe(today());

    mockConn = createFakeDb();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const s2 = await handler({});
    expect(s2.run_date).toBe(today());

    mockConn = createFakeDb();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const s3 = await handler({ arbitrary: 'x' });
    expect(s3.run_date).toBe(today());
  });

  test('auto-creates the open release when none exists', async () => {
    const { handler } = loadHandler();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });

    await handler({});
    expect(mockConn._tables.releases.size).toBe(1);
    const release = [...mockConn._tables.releases.values()][0];
    const gateRow = [...mockConn._tables.gate_results.values()][0];
    expect(gateRow.release_id).toBe(release.release_id);
  });

  test('re-invoking on the same run_date keeps exactly one gate_results row', async () => {
    const { handler } = loadHandler();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await handler({});
    await handler({});
    expect(mockConn._tables.gate_results.size).toBe(1);
  });

  test('error isolation: one project failing does not stop the others, but handler() rejects', async () => {
    const { handler } = loadHandler();
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedProject(mockConn, { project_id: 'proj-2', name: 'Beta' });

    const realExecute = mockConn.execute.bind(mockConn);
    mockConn.execute = jest.fn((sql, params) => {
      if (sql.includes('FROM thresholds') && sql.includes('ROW_NUMBER') && params[0] === 'proj-1') {
        return Promise.reject(new Error('boom'));
      }
      return realExecute(sql, params);
    });

    await expect(handler({})).rejects.toThrow();
    expect(mockConn._tables.gate_results.size).toBe(1);
    const gateRow = [...mockConn._tables.gate_results.values()][0];
    expect(gateRow.project_id).toBe('proj-2');
  });
});
