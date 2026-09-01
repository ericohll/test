let mockConn;
jest.mock('../../src/lib/db', () => ({
  withConnection: (fn) => fn(mockConn),
  withTransaction: (fn) => fn(mockConn),
}));

const { createFakeDb } = require('../helpers/fakeDb');
const { apiEvent } = require('../helpers/apiEvent');
const { seedProject, seedRelease, seedGateResult, seedFinding } = require('../helpers/seed');
const { handler } = require('../../src/handlers/api-portfolio');

beforeEach(() => {
  mockConn = createFakeDb();
});

function event(query) {
  return apiEvent({ resource: '/portfolio/summary', query });
}

async function seedThree() {
  // proj-1: failing gate, some critical/high findings -> highest risk.
  await seedProject(mockConn, { project_id: 'proj-1', name: 'Alpha' });
  await seedRelease(mockConn, { release_id: 'rel-1', project_id: 'proj-1', release_name: 'R1' });
  await seedGateResult(mockConn, { release_id: 'rel-1', project_id: 'proj-1', status: 'fail', failed_metrics: [{ metric_type: 'coverage' }] });
  await seedFinding(mockConn, { tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F1', severity: 'critical', status: 'open' });
  await seedFinding(mockConn, { tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F2', severity: 'high', status: 'open' });

  // proj-2: passing gate, a couple of low findings.
  await seedProject(mockConn, { project_id: 'proj-2', name: 'Beta' });
  await seedRelease(mockConn, { release_id: 'rel-2', project_id: 'proj-2', release_name: 'R2' });
  await seedGateResult(mockConn, { release_id: 'rel-2', project_id: 'proj-2', status: 'pass', failed_metrics: [] });
  await seedFinding(mockConn, { tool: 'trivy', project_id: 'proj-2', external_finding_id: 'F3', severity: 'low', status: 'open' });

  // proj-3: no release, no findings -> unknown, risk 0.
  await seedProject(mockConn, { project_id: 'proj-3', name: 'Gamma' });
}

describe('GET /portfolio/summary', () => {
  test('three projects, mixed gate statuses -> 200 with consistent totals', async () => {
    await seedThree();
    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.projects_total).toBe(3);
    const sumStatuses = Object.values(body.gate_status_counts).reduce((a, b) => a + b, 0);
    expect(sumStatuses).toBe(3);
    expect(body.open_findings_by_severity.total).toBe(body.open_findings_total);
    // sorted by risk_score DESC -- the failing project must come first.
    expect(body.projects[0].project_id).toBe('proj-1');
    const scores = body.projects.map((p) => p.risk_score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  test('top=1 truncates the projects list but gate_status_counts still covers all 3', async () => {
    await seedThree();
    const res = await handler(event({ top: '1' }));
    const body = JSON.parse(res.body);
    expect(body.projects).toHaveLength(1);
    const sumStatuses = Object.values(body.gate_status_counts).reduce((a, b) => a + b, 0);
    expect(sumStatuses).toBe(3);
  });

  test.each(['abc', '0', '101'])('top=%s -> 400', async (top) => {
    const res = await handler(event({ top }));
    expect(res.statusCode).toBe(400);
  });

  test('project with no release and no findings -> gate_status unknown, risk_score 0', async () => {
    await seedThree();
    const res = await handler(event());
    const body = JSON.parse(res.body);
    const gamma = body.projects.find((p) => p.project_id === 'proj-3');
    expect(gamma.gate_status).toBe('unknown');
    expect(gamma.risk_score).toBe(0);
  });
});
