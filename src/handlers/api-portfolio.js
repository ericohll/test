const { createApiHandler, intParam } = require('../lib/apiHandler');
const { ok } = require('../lib/http');
const { listProjects } = require('../repo/projects');
const { getOpenReleaseForProject } = require('../repo/releases');
const { getLatestGateResult } = require('../repo/gateResults');
const { countOpenFindingsBySeverity } = require('../repo/findings');
const { parseFailedMetrics } = require('../lib/gate');
const { foldCounts, riskScore } = require('../lib/summary');

async function portfolioSummaryRoute(req, conn) {
  const top = intParam(req.query, 'top', { default: 20, min: 1, max: 100 });

  const projects = await listProjects(conn);
  const countRows = await countOpenFindingsBySeverity(conn, null);
  const countsByProject = new Map();
  for (const r of countRows) {
    const entry = countsByProject.get(r.project_id) || [];
    entry.push(r);
    countsByProject.set(r.project_id, entry);
  }

  const gate_status_counts = { pass: 0, fail: 0, unknown: 0 };
  const rows = [];
  for (const p of projects) {
    const release = await getOpenReleaseForProject(conn, p.project_id);
    let gate_status = 'unknown';
    let failed_metric_count = 0;
    if (release) {
      const gateRow = await getLatestGateResult(conn, release.release_id);
      if (gateRow) {
        gate_status = gateRow.status;
        failed_metric_count = parseFailedMetrics(gateRow.failed_metrics).length;
      }
    }
    gate_status_counts[gate_status] += 1;

    const open_findings = foldCounts(countsByProject.get(p.project_id) || []);
    const risk_score = riskScore(open_findings, gate_status);

    rows.push({
      project_id: p.project_id,
      name: p.name,
      release_id: release ? release.release_id : null,
      gate_status,
      failed_metric_count,
      open_findings,
      risk_score,
    });
  }

  // gate_status_counts covers every project even though the `projects` list
  // below is truncated to `top`.
  rows.sort((a, b) => b.risk_score - a.risk_score || a.project_id.localeCompare(b.project_id));

  const open_findings_by_severity = foldCounts(countRows);

  return ok({
    generated_at: new Date().toISOString(),
    projects_total: projects.length,
    gate_status_counts,
    open_findings_total: open_findings_by_severity.total,
    open_findings_by_severity,
    top,
    projects: rows.slice(0, top),
  });
}

exports.handler = createApiHandler({
  'GET /portfolio/summary': portfolioSummaryRoute,
});

module.exports.portfolioSummaryRoute = portfolioSummaryRoute;
