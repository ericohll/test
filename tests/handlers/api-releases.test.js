let mockConn;
jest.mock('../../src/lib/db', () => ({
  withConnection: (fn) => fn(mockConn),
  withTransaction: (fn) => fn(mockConn),
}));

const { createFakeDb } = require('../helpers/fakeDb');
const { apiEvent, claimsFor, noAuthEvent } = require('../helpers/apiEvent');
const { seedProject, seedRelease, seedGateResult } = require('../helpers/seed');
const { handler } = require('../../src/handlers/api-releases');

beforeEach(() => {
  mockConn = createFakeDb();
});

async function seedBasic(status = 'fail', failed_metrics = [{ metric_type: 'coverage', operator: 'gte', threshold_value: 80, value: 62, tool: 'sonarqube', run_date: '2026-09-01' }]) {
  await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
  await seedRelease(mockConn, { release_id: 'rel-1', project_id: 'proj-1', release_name: 'R1' });
  await seedGateResult(mockConn, { release_id: 'rel-1', project_id: 'proj-1', run_date: '2026-09-01', status, failed_metrics });
}

describe('GET /releases/{id}/gate-check (API key, no auth)', () => {
  test('spec criterion: noAuthEvent works, 200, status pass', async () => {
    await seedBasic('pass', []);
    const event = noAuthEvent({ resource: '/releases/{id}/gate-check', pathParameters: { id: 'rel-1' } });
    const getIdentitySpy = jest.spyOn(require('../../src/lib/auth'), 'getIdentity');
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('pass');
    expect(getIdentitySpy).not.toHaveBeenCalled();
    getIdentitySpy.mockRestore();
  });

  test('requestContext entirely absent still works', async () => {
    await seedBasic('pass', []);
    const event = noAuthEvent({ resource: '/releases/{id}/gate-check', pathParameters: { id: 'rel-1' } });
    delete event.requestContext;
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
  });

  test('no gate_results row -> 200, status unknown', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedRelease(mockConn, { release_id: 'rel-1', project_id: 'proj-1', release_name: 'R1' });
    const event = noAuthEvent({ resource: '/releases/{id}/gate-check', pathParameters: { id: 'rel-1' } });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ status: 'unknown', run_date: null, evaluated_at: null, failed_metrics: [] });
  });

  test('unknown release_id -> 404', async () => {
    const event = noAuthEvent({ resource: '/releases/{id}/gate-check', pathParameters: { id: 'does-not-exist' } });
    const res = await handler(event);
    expect(res.statusCode).toBe(404);
  });

  test('failed_metrics is an array of metric_type strings only', async () => {
    await seedBasic('fail');
    const event = noAuthEvent({ resource: '/releases/{id}/gate-check', pathParameters: { id: 'rel-1' } });
    const res = await handler(event);
    const body = JSON.parse(res.body);
    expect(body.failed_metrics).toEqual(['coverage']);
  });
});

describe('GET /releases/{id}/gate-status (Cognito)', () => {
  test('Viewer group -> 200 with full failed_metrics objects + release block', async () => {
    await seedBasic('fail');
    const event = apiEvent({
      resource: '/releases/{id}/gate-status',
      pathParameters: { id: 'rel-1' },
      claims: claimsFor({ groups: 'Viewer' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.release.release_id).toBe('rel-1');
    expect(body.status).toBe('fail');
    expect(body.failed_metrics[0]).toMatchObject({ metric_type: 'coverage', operator: 'gte', threshold_value: 80, value: 62 });
  });

  test('seeded failed_metrics as a JSON string still yields an array in the response', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedRelease(mockConn, { release_id: 'rel-1', project_id: 'proj-1', release_name: 'R1' });
    // Bypass seedGateResult (which always JSON.stringifies an array) by inserting directly
    // through the repo function with an already-stringified array to mimic a string column read.
    const gateResults = require('../../src/repo/gateResults');
    await gateResults.upsertGateResult(mockConn, {
      release_id: 'rel-1', project_id: 'proj-1', run_date: '2026-09-01', status: 'fail',
      failed_metrics: [{ metric_type: 'coverage' }],
    });
    // Simulate a raw string value as some drivers might return for JSON columns.
    const row = [...mockConn._tables.gate_results.values()][0];
    row.failed_metrics = JSON.stringify(row.failed_metrics);

    const event = apiEvent({
      resource: '/releases/{id}/gate-status',
      pathParameters: { id: 'rel-1' },
      claims: claimsFor({ groups: 'Viewer' }),
    });
    const res = await handler(event);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.failed_metrics)).toBe(true);
    expect(body.failed_metrics[0].metric_type).toBe('coverage');
  });

  test('unknown release -> 404', async () => {
    const event = apiEvent({
      resource: '/releases/{id}/gate-status',
      pathParameters: { id: 'nope' },
      claims: claimsFor({ groups: 'Viewer' }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(404);
  });
});
