const { createApiHandler } = require('../lib/apiHandler');
const { ok, notFound } = require('../lib/http');
const { listProjects, getProject } = require('../repo/projects');
const { getOpenReleaseForProject } = require('../repo/releases');
const { getCurrentThresholds } = require('../repo/thresholds');
const { getLatestMetricsForProject } = require('../repo/metrics');
const { getLatestGateResult } = require('../repo/gateResults');
const { countOpenFindingsBySeverity } = require('../repo/findings');
const { describeMetrics, parseFailedMetrics } = require('../lib/gate');
const { foldCounts } = require('../lib/summary');
const { toDateString } = require('../lib/runDate');

async function listProjectsRoute(req, conn) {
  const projects = await listProjects(conn);
  const result = [];
  for (const p of projects) {
    const release = await getOpenReleaseForProject(conn, p.project_id);
    let status = 'unknown';
    if (release) {
      const gateRow = await getLatestGateResult(conn, release.release_id);
      if (gateRow) status = gateRow.status;
    }
    result.push({
      project_id: p.project_id,
      name: p.name,
      repo_url: p.repo_url,
      open_release_id: release ? release.release_id : null,
      status,
    });
  }
  return ok({ count: result.length, projects: result });
}

async function dashboardRoute(req, conn) {
  const projectId = req.pathParams.id;
  const project = await getProject(conn, projectId);
  if (!project) return notFound('Project not found');

  const release = await getOpenReleaseForProject(conn, projectId);
  const thresholdRows = await getCurrentThresholds(conn, projectId);
  const metricRows = await getLatestMetricsForProject(conn, projectId);
  const gateRow = release ? await getLatestGateResult(conn, release.release_id) : null;
  const countRows = await countOpenFindingsBySeverity(conn, projectId);

  const gate = gateRow
    ? {
      status: gateRow.status,
      failed_metrics: parseFailedMetrics(gateRow.failed_metrics),
      run_date: toDateString(gateRow.run_date),
      evaluated_at: gateRow.evaluated_at,
    }
    : { status: 'unknown', failed_metrics: [], run_date: null, evaluated_at: null };

  return ok({
    project: { project_id: project.project_id, name: project.name, repo_url: project.repo_url },
    release: release ? {
      release_id: release.release_id,
      release_name: release.release_name,
      status: release.status,
      target_date: toDateString(release.target_date),
    } : null,
    gate,
    metrics: describeMetrics(metricRows, thresholdRows),
    thresholds: thresholdRows.map((t) => ({
      metric_type: t.metric_type,
      operator: t.operator,
      threshold_value: Number(t.threshold_value),
      updated_by: t.updated_by,
      updated_at: t.updated_at,
    })),
    findings_summary: foldCounts(countRows),
  });
}

exports.handler = createApiHandler({
  'GET /projects': listProjectsRoute,
  'GET /projects/{id}/dashboard': dashboardRoute,
});

module.exports.listProjectsRoute = listProjectsRoute;
module.exports.dashboardRoute = dashboardRoute;
