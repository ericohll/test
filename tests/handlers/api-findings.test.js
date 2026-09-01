let mockConn;
jest.mock('../../src/lib/db', () => ({
  withConnection: (fn) => fn(mockConn),
  withTransaction: (fn) => fn(mockConn),
}));

const { createFakeDb } = require('../helpers/fakeDb');
const { apiEvent } = require('../helpers/apiEvent');
const { seedProject, seedFinding } = require('../helpers/seed');
const { handler } = require('../../src/handlers/api-findings');

beforeEach(async () => {
  mockConn = createFakeDb();
  await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
  await seedProject(mockConn, { project_id: 'proj-2', name: 'Beta' });
  await seedFinding(mockConn, { tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F1', severity: 'critical', status: 'open', run_date: '2026-09-01' });
  await seedFinding(mockConn, { tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F2', severity: 'high', status: 'confirmed', run_date: '2026-09-01' });
  await seedFinding(mockConn, { tool: 'sonarqube', project_id: 'proj-1', external_finding_id: 'F3', severity: 'low', status: 'resolved', run_date: '2026-09-01' });
  await seedFinding(mockConn, { tool: 'sonarqube', project_id: 'proj-2', external_finding_id: 'F4', severity: 'medium', status: 'open', run_date: '2026-09-01' });
  await seedFinding(mockConn, { tool: 'sonarqube', project_id: 'proj-2', external_finding_id: 'F5', severity: 'high', status: 'open', run_date: '2026-09-01' });
});

function event(query) {
  return apiEvent({ resource: '/findings', query });
}

describe('GET /findings', () => {
  test('no filters -> 200, page.limit default 50, all 5 rows', async () => {
    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.page.limit).toBe(50);
    expect(body.findings).toHaveLength(5);
    expect(Object.keys(body).sort()).toEqual(['filters', 'findings', 'page']);
    expect(body.findings[0].last_run_date).toBe('2026-09-01');
  });

  test('project_id filter narrows results', async () => {
    const res = await handler(event({ project_id: 'proj-1' }));
    const body = JSON.parse(res.body);
    expect(body.findings).toHaveLength(3);
    expect(body.filters.project_id).toBe('proj-1');
  });

  test('status filter narrows results', async () => {
    const res = await handler(event({ status: 'open' }));
    const body = JSON.parse(res.body);
    expect(body.findings).toHaveLength(3);
  });

  test('severity filter narrows results', async () => {
    const res = await handler(event({ severity: 'high' }));
    const body = JSON.parse(res.body);
    expect(body.findings).toHaveLength(2);
  });

  test('combined filters narrow further', async () => {
    const res = await handler(event({ project_id: 'proj-2', status: 'open', severity: 'high' }));
    const body = JSON.parse(res.body);
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].external_finding_id).toBe('F5');
  });

  test('limit and offset paginate and echo back in page', async () => {
    const res = await handler(event({ limit: '2', offset: '2' }));
    const body = JSON.parse(res.body);
    expect(body.findings).toHaveLength(2);
    expect(body.page).toEqual({ limit: 2, offset: 2, count: 2 });
  });

  test('invalid severity -> 400', async () => {
    const res = await handler(event({ severity: 'catastrophic' }));
    expect(res.statusCode).toBe(400);
  });

  test('invalid status -> 400', async () => {
    const res = await handler(event({ status: 'bogus' }));
    expect(res.statusCode).toBe(400);
  });

  test.each([['limit', '0'], ['limit', '500'], ['limit', 'abc'], ['offset', '-1']])('%s=%s -> 400', async (key, value) => {
    const res = await handler(event({ [key]: value }));
    expect(res.statusCode).toBe(400);
  });
});
