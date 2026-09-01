const { createApiHandler, intParam, enumParam, requiredString } = require('../lib/apiHandler');
const { ok } = require('../lib/http');
const { listFindings } = require('../repo/findings');
const { SEVERITIES } = require('../lib/summary');
const { toDateString } = require('../lib/runDate');

const STATUSES = ['open', 'confirmed', 'resolved', 'false_positive', 'reopened'];

async function listFindingsRoute(req, conn) {
  const { query } = req;
  const project_id = query.project_id ? requiredString(query, 'project_id', { maxLength: 64 }) : undefined;
  const status = enumParam(query, 'status', STATUSES);
  const severity = enumParam(query, 'severity', SEVERITIES);
  const limit = intParam(query, 'limit', { default: 50, min: 1, max: 200 });
  const offset = intParam(query, 'offset', { default: 0, min: 0, max: 100000 });

  const rows = await listFindings(conn, { project_id, status, severity, limit, offset });

  return ok({
    findings: rows.map((r) => ({
      finding_id: r.finding_id,
      tool: r.tool,
      project_id: r.project_id,
      external_finding_id: r.external_finding_id,
      title: r.title,
      severity: r.severity,
      status: r.status,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      last_run_date: toDateString(r.last_run_date),
      raw_ref: r.raw_ref,
    })),
    page: { limit, offset, count: rows.length },
    filters: { project_id: project_id || null, status: status || null, severity: severity || null },
  });
}

exports.handler = createApiHandler({
  'GET /findings': listFindingsRoute,
});

module.exports.listFindingsRoute = listFindingsRoute;
