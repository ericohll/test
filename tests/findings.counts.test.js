const { createFakeDb } = require('./helpers/fakeDb');
const findings = require('../src/repo/findings');
const { seedProject, seedFinding } = require('./helpers/seed');

describe('findings repo: countOpenFindingsBySeverity', () => {
  async function seedFixture(db) {
    await seedProject(db, { project_id: 'proj-1', name: 'Alpha' });
    await seedProject(db, { project_id: 'proj-2', name: 'Beta' });

    await seedFinding(db, {
      tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F1', severity: 'critical', status: 'open',
    });
    await seedFinding(db, {
      tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F2', severity: 'high', status: 'confirmed',
    });
    await seedFinding(db, {
      tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F3', severity: 'high', status: 'reopened',
    });
    await seedFinding(db, {
      tool: 'trivy', project_id: 'proj-1', external_finding_id: 'F4', severity: 'medium', status: 'resolved',
    });
    await seedFinding(db, {
      tool: 'sonarqube', project_id: 'proj-2', external_finding_id: 'F5', severity: 'critical', status: 'false_positive',
    });
    await seedFinding(db, {
      tool: 'sonarqube', project_id: 'proj-2', external_finding_id: 'F6', severity: 'low', status: 'open',
    });
  }

  test('per-project: excludes resolved and false_positive, returns Number counts', async () => {
    const db = createFakeDb();
    await seedFixture(db);

    const rows = await findings.countOpenFindingsBySeverity(db, 'proj-1');
    // F4 (resolved) must not appear at all.
    const bySeverity = Object.fromEntries(rows.map((r) => [r.severity, r.count]));
    expect(bySeverity.critical).toBe(1);
    expect(bySeverity.high).toBe(2);
    expect(bySeverity.medium).toBeUndefined();
    for (const r of rows) {
      expect(r.project_id).toBe('proj-1');
      expect(typeof r.count).toBe('number');
    }
  });

  test('rollup (projectId = null) returns rows for every project', async () => {
    const db = createFakeDb();
    await seedFixture(db);

    const rows = await findings.countOpenFindingsBySeverity(db, null);
    const projectIds = new Set(rows.map((r) => r.project_id));
    expect(projectIds).toEqual(new Set(['proj-1', 'proj-2']));
    // proj-2's false_positive finding must be excluded; only the open 'low' one counts.
    const proj2Rows = rows.filter((r) => r.project_id === 'proj-2');
    expect(proj2Rows).toEqual([{ project_id: 'proj-2', severity: 'low', count: 1 }]);
  });

  test('no open findings for a project returns an empty array', async () => {
    const db = createFakeDb();
    await seedProject(db, { project_id: 'proj-3', name: 'Gamma' });
    const rows = await findings.countOpenFindingsBySeverity(db, 'proj-3');
    expect(rows).toEqual([]);
  });
});
