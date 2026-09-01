let mockConn;
jest.mock('../../src/lib/db', () => ({
  withConnection: (fn) => fn(mockConn),
  withTransaction: (fn) => fn(mockConn),
}));

const { createFakeDb } = require('../helpers/fakeDb');
const { apiEvent } = require('../helpers/apiEvent');
const {
  seedProject, seedRelease, seedThreshold, seedMetric, seedGateResult, seedFinding,
} = require('../helpers/seed');
const { handler } = require('../../src/handlers/api-projects');

beforeEach(() => {
  mockConn = createFakeDb();
});

describe('GET /projects', () => {
  test('two projects, one with an open release+fail gate, one bare -> 200, name-ASC', async () => {
    await seedProject(mockConn, { project_id: 'proj-2', name: 'Zeta' });
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedRelease(mockConn, { release_id: 'rel-1', project_id: 'proj-1', release_name: 'R1' });
    await seedGateResult(mockConn, { release_id: 'rel-1', project_id: 'proj-1', status: 'fail', failed_metrics: [{ metric_type: 'coverage' }] });

    const res = await handler(apiEvent({ method: 'GET', resource: '/projects' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.count).toBe(2);
    expect(body.projects.map((p) => p.name)).toEqual(['Alpha', 'Zeta']);
    const alpha = body.projects.find((p) => p.project_id === 'proj-1');
    expect(alpha.status).toBe('fail');
    expect(alpha.open_release_id).toBe('rel-1');
    const zeta = body.projects.find((p) => p.project_id === 'proj-2');
    expect(zeta.status).toBe('unknown');
    expect(zeta.open_release_id).toBeNull();
  });
});

describe('GET /projects/{id}/dashboard', () => {
  async function seedFull() {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    await seedRelease(mockConn, { release_id: 'rel-1', project_id: 'proj-1', release_name: 'R1' });
    await seedThreshold(mockConn, { project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 80, updated_by: 'a@b.com' });
    await seedThreshold(mockConn, { project_id: 'proj-1', metric_type: 'critical_findings', operator: 'lte', threshold_value: 5, updated_by: 'a@b.com' });
    await seedMetric(mockConn, { project_id: 'proj-1', tool: 'sonarqube', metric_type: 'coverage', value: 62, unit: '%', run_date: '2026-09-01' });
    await seedMetric(mockConn, { project_id: 'proj-1', tool: 'trivy', metric_type: 'critical_findings', value: 2, run_date: '2026-09-01' });
    await seedMetric(mockConn, { project_id: 'proj-1', tool: 'sonarqube', metric_type: 'duplication', value: 3, unit: '%', run_date: '2026-09-01' });
    await seedGateResult(mockConn, {
      release_id: 'rel-1', project_id: 'proj-1', run_date: '2026-09-01', status: 'fail',
      failed_metrics: [{ metric_type: 'coverage', operator: 'gte', threshold_value: 80, value: 62, tool: 'sonarqube', run_date: '2026-09-01' }],
    });
    await seedFinding(mockConn, { tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F1', severity: 'critical', status: 'open', run_date: '2026-09-01' });
    await seedFinding(mockConn, { tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F2', severity: 'high', status: 'confirmed', run_date: '2026-09-01' });
    await seedFinding(mockConn, { tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F3', severity: 'low', status: 'resolved', run_date: '2026-09-01' });
  }

  test('full seed -> 200 with project/release/gate/metrics/thresholds/findings_summary', async () => {
    await seedFull();
    const res = await handler(apiEvent({ resource: '/projects/{id}/dashboard', pathParameters: { id: 'proj-1' } }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.project.project_id).toBe('proj-1');
    expect(body.release.release_id).toBe('rel-1');
    expect(body.gate.status).toBe('fail');
    expect(body.gate.run_date).toBe('2026-09-01');

    const dup = body.metrics.find((m) => m.metric_type === 'duplication');
    expect(dup.threshold).toBeNull();
    expect(dup.passing).toBeNull();
    const cov = body.metrics.find((m) => m.metric_type === 'coverage');
    expect(cov.passing).toBe(false);
    expect(cov.run_date).toBe('2026-09-01');

    expect(body.thresholds).toHaveLength(2);
    // resolved finding excluded from the summary
    expect(body.findings_summary).toEqual({ critical: 1, high: 1, medium: 0, low: 0, info: 0, total: 2 });
  });

  test('unknown project id -> 404', async () => {
    const res = await handler(apiEvent({ resource: '/projects/{id}/dashboard', pathParameters: { id: 'nope' } }));
    expect(res.statusCode).toBe(404);
  });

  test('project with no open release -> 200, release null, gate unknown', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    const res = await handler(apiEvent({ resource: '/projects/{id}/dashboard', pathParameters: { id: 'proj-1' } }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.release).toBeNull();
    expect(body.gate).toEqual({ status: 'unknown', failed_metrics: [], run_date: null, evaluated_at: null });
  });

  test('unrouted DELETE -> 404', async () => {
    const res = await handler(apiEvent({ method: 'DELETE', resource: '/projects/{id}/dashboard', pathParameters: { id: 'proj-1' } }));
    expect(res.statusCode).toBe(404);
  });

  test('db failure -> 500', async () => {
    await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
    mockConn.execute = jest.fn().mockRejectedValue(new Error('boom'));
    const res = await handler(apiEvent({ resource: '/projects/{id}/dashboard', pathParameters: { id: 'proj-1' } }));
    expect(res.statusCode).toBe(500);
  });
});
