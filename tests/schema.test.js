const fs = require('fs');
const path = require('path');

const rawSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_init.sql'), 'utf8');
// Strip SQL line comments so assertions can't false-positive on the word "UPDATE" inside prose.
const sql = rawSql.replace(/--.*$/gm, '');

const TABLES = [
  'schema_migrations', 'projects', 'releases', 'ingestion_batches', 'metrics',
  'findings', 'finding_lifecycle_events', 'thresholds', 'gate_results', 'user_actions',
];

describe('001_init.sql', () => {
  test.each(TABLES)('creates table %s', (table) => {
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} `));
  });

  test('ingestion_batches is keyed by the deterministic batch_key', () => {
    expect(sql).toMatch(/ingestion_batches[\s\S]*?PRIMARY KEY \(batch_key\)/);
  });

  test('metrics has a unique key on the natural (project,tool,run_date,metric_type) tuple', () => {
    expect(sql).toMatch(/UNIQUE KEY uq_metrics_natural \(project_id, tool, run_date, metric_type\)/);
  });

  test('findings is keyed by the deterministic finding_id and has a source uniqueness key', () => {
    expect(sql).toMatch(/findings \(\s*finding_id\s+CHAR\(64\)/);
    expect(sql).toMatch(/UNIQUE KEY uq_findings_source \(tool, project_id, external_finding_id\)/);
  });

  test('finding_lifecycle_events is append-only (no ON DUPLICATE KEY UPDATE) and replay-safe', () => {
    const table = sql.split('CREATE TABLE IF NOT EXISTS finding_lifecycle_events')[1].split('CREATE TABLE')[0];
    expect(table).toMatch(/UNIQUE KEY uq_fle_replay \(finding_id, source_run, event_type\)/);
    expect(table).not.toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  test('thresholds is append-only version history with no unique key collapsing versions (OED-03)', () => {
    const table = sql.split('CREATE TABLE IF NOT EXISTS thresholds')[1].split('CREATE TABLE')[0];
    expect(table).not.toMatch(/UNIQUE KEY/);
    expect(table).not.toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  test('releases enforces at most one open release per project via a generated column', () => {
    const table = sql.split('CREATE TABLE IF NOT EXISTS releases')[1].split('CREATE TABLE')[0];
    expect(table).toMatch(/GENERATED ALWAYS AS \(IF\(status = 'open', project_id, NULL\)\) STORED/);
    expect(table).toMatch(/UNIQUE KEY uq_releases_one_open_per_project \(open_project_marker\)/);
  });

  test('gate_results is unique per (release_id, run_date) so re-evaluation overwrites, not duplicates', () => {
    expect(sql).toMatch(/UNIQUE KEY uq_gate_release_run \(release_id, run_date\)/);
  });

  test('user_actions is a plain append-only audit log', () => {
    const table = sql.split('CREATE TABLE IF NOT EXISTS user_actions')[1].split('CREATE TABLE')[0];
    expect(table).not.toMatch(/ON DUPLICATE KEY UPDATE/);
  });
});
