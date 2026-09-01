const { createFakeDb } = require('./helpers/fakeDb');
const thresholds = require('../src/repo/thresholds');

// Locks in the OED-03 resolution: thresholds is append-only version history,
// "current" = max(updated_at) tie-broken by max(threshold_id).
describe('thresholds repo (OED-03: append-only versioning)', () => {
  test('inserting a new version does not delete or overwrite prior versions', async () => {
    const db = createFakeDb();
    await thresholds.insertThresholdVersion(db, {
      project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 80, updated_by: 'alice',
    });
    await thresholds.insertThresholdVersion(db, {
      project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 85, updated_by: 'bob',
    });
    expect(db._tables.thresholds).toHaveLength(2);
  });

  test('getCurrentThreshold returns the most recently inserted version', async () => {
    const db = createFakeDb();
    await thresholds.insertThresholdVersion(db, {
      project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 80, updated_by: 'alice',
    });
    await thresholds.insertThresholdVersion(db, {
      project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 85, updated_by: 'bob',
    });
    const current = await thresholds.getCurrentThreshold(db, 'proj-1', 'coverage');
    expect(current.threshold_value).toBe(85);
    expect(current.updated_by).toBe('bob');
  });

  test('getCurrentThresholds returns one row per metric_type, each the latest version', async () => {
    const db = createFakeDb();
    await thresholds.insertThresholdVersion(db, {
      project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 80, updated_by: 'alice',
    });
    await thresholds.insertThresholdVersion(db, {
      project_id: 'proj-1', metric_type: 'critical_findings', operator: 'eq', threshold_value: 0, updated_by: 'alice',
    });
    await thresholds.insertThresholdVersion(db, {
      project_id: 'proj-1', metric_type: 'coverage', operator: 'gte', threshold_value: 90, updated_by: 'bob',
    });
    const rows = await thresholds.getCurrentThresholds(db, 'proj-1');
    expect(rows).toHaveLength(2);
    const coverage = rows.find((r) => r.metric_type === 'coverage');
    expect(coverage.threshold_value).toBe(90);
  });
});
