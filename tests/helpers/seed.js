// Thin wrappers over the real src/repo/*.js functions (never writing directly
// to db._tables) so handler/lib tests seed fixtures the same way production
// code would write them.

const projects = require('../../src/repo/projects');
const releases = require('../../src/repo/releases');
const metrics = require('../../src/repo/metrics');
const thresholds = require('../../src/repo/thresholds');
const findings = require('../../src/repo/findings');
const gateResults = require('../../src/repo/gateResults');
const { findingId } = require('../../src/lib/ids');
const { today } = require('../../src/lib/runDate');

async function seedProject(db, { project_id, name, repo_url } = {}) {
  await projects.upsertProject(db, { project_id, name, repo_url: repo_url || null });
  return projects.getProject(db, project_id);
}

async function seedRelease(db, { release_id, project_id, release_name, target_date } = {}) {
  await releases.createRelease(db, {
    release_id,
    project_id,
    release_name: release_name || `${project_id} release`,
    target_date: target_date || null,
  });
  return releases.getRelease(db, release_id);
}

async function seedMetric(db, { project_id, tool, run_date, metric_type, release_id, value, unit, batch_key } = {}) {
  await metrics.upsertMetric(db, {
    project_id,
    tool,
    run_date: run_date || today(),
    metric_type,
    release_id: release_id || null,
    value,
    unit: unit || null,
    batch_key: batch_key || null,
  });
}

async function seedThreshold(db, { project_id, metric_type, operator, threshold_value, updated_by } = {}) {
  return thresholds.insertThresholdVersion(db, {
    project_id,
    metric_type,
    operator,
    threshold_value,
    updated_by: updated_by || 'seed@example.com',
  });
}

async function seedFinding(db, {
  tool, project_id, external_finding_id, title, severity, status, seen_at, run_date, raw_ref, source_run,
} = {}) {
  const finding_id = findingId(tool, project_id, external_finding_id);
  const resolvedSeenAt = seen_at || '2026-09-01 00:00:00.000';
  const resolvedRunDate = run_date || today();
  await findings.upsertFinding(db, {
    finding_id,
    tool,
    project_id,
    external_finding_id,
    title: title || null,
    severity: severity || 'info',
    status: status || 'open',
    seen_at: resolvedSeenAt,
    run_date: resolvedRunDate,
    raw_ref: raw_ref || null,
  }, source_run || `${tool}#${project_id}#${resolvedRunDate}`);
  return findings.getFindingById(db, finding_id);
}

async function seedGateResult(db, { release_id, project_id, run_date, status, failed_metrics } = {}) {
  await gateResults.upsertGateResult(db, {
    release_id,
    project_id,
    run_date: run_date || today(),
    status,
    failed_metrics: failed_metrics || [],
  });
  return gateResults.getLatestGateResult(db, release_id);
}

module.exports = {
  seedProject, seedRelease, seedMetric, seedThreshold, seedFinding, seedGateResult,
};
