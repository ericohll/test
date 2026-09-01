const { createFakeDb } = require('./helpers/fakeDb');
const findings = require('../src/repo/findings');
const { findingId } = require('../src/lib/ids');

describe('findings repo (idempotent upsert + lifecycle events)', () => {
  const fid = findingId('sonarqube', 'proj-1', 'ISSUE-1');

  test('first sighting creates the finding and a single "created" lifecycle event', async () => {
    const db = createFakeDb();
    await findings.upsertFinding(db, {
      finding_id: fid, tool: 'sonarqube', project_id: 'proj-1', external_finding_id: 'ISSUE-1',
      title: 'Null deref', severity: 'high', status: 'open', seen_at: '2026-09-01 02:00:00.000',
      run_date: '2026-09-01',
    }, 'sonarqube#proj-1#2026-09-01');

    const stored = await findings.getFindingById(db, fid);
    expect(stored.severity).toBe('high');
    expect(db._tables.finding_lifecycle_events).toHaveLength(1);
    expect(db._tables.finding_lifecycle_events[0].event_type).toBe('created');
  });

  test('replaying the same batch is idempotent: no duplicate lifecycle events', async () => {
    const db = createFakeDb();
    const finding = {
      finding_id: fid, tool: 'sonarqube', project_id: 'proj-1', external_finding_id: 'ISSUE-1',
      title: 'Null deref', severity: 'high', status: 'open', seen_at: '2026-09-01 02:00:00.000',
      run_date: '2026-09-01',
    };
    const sourceRun = 'sonarqube#proj-1#2026-09-01';
    await findings.upsertFinding(db, finding, sourceRun);
    await findings.upsertFinding(db, finding, sourceRun);
    expect(db._tables.finding_lifecycle_events).toHaveLength(1);
  });

  test('severity change on a later run appends a severity_changed event without duplicating the finding row', async () => {
    const db = createFakeDb();
    await findings.upsertFinding(db, {
      finding_id: fid, tool: 'sonarqube', project_id: 'proj-1', external_finding_id: 'ISSUE-1',
      title: 'Null deref', severity: 'high', status: 'open', seen_at: '2026-09-01 02:00:00.000',
      run_date: '2026-09-01',
    }, 'sonarqube#proj-1#2026-09-01');

    await findings.upsertFinding(db, {
      finding_id: fid, tool: 'sonarqube', project_id: 'proj-1', external_finding_id: 'ISSUE-1',
      title: 'Null deref', severity: 'critical', status: 'open', seen_at: '2026-09-02 02:00:00.000',
      run_date: '2026-09-02',
    }, 'sonarqube#proj-1#2026-09-02');

    expect(db._tables.findings.size).toBe(1);
    const stored = await findings.getFindingById(db, fid);
    expect(stored.severity).toBe('critical');
    const eventTypes = db._tables.finding_lifecycle_events.map((e) => e.event_type);
    expect(eventTypes).toEqual(['created', 'severity_changed']);
  });

  test('resolving a finding appends a resolved event', async () => {
    const db = createFakeDb();
    await findings.upsertFinding(db, {
      finding_id: fid, tool: 'sonarqube', project_id: 'proj-1', external_finding_id: 'ISSUE-1',
      title: 'Null deref', severity: 'high', status: 'open', seen_at: '2026-09-01 02:00:00.000',
      run_date: '2026-09-01',
    }, 'sonarqube#proj-1#2026-09-01');

    await findings.upsertFinding(db, {
      finding_id: fid, tool: 'sonarqube', project_id: 'proj-1', external_finding_id: 'ISSUE-1',
      title: 'Null deref', severity: 'high', status: 'resolved', seen_at: '2026-09-02 02:00:00.000',
      run_date: '2026-09-02',
    }, 'sonarqube#proj-1#2026-09-02');

    const eventTypes = db._tables.finding_lifecycle_events.map((e) => e.event_type);
    expect(eventTypes).toEqual(['created', 'resolved']);
  });
});
