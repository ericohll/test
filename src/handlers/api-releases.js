const { createApiHandler } = require('../lib/apiHandler');
const { ok, notFound } = require('../lib/http');
const { getIdentity } = require('../lib/auth');
const { getRelease } = require('../repo/releases');
const { getLatestGateResult } = require('../repo/gateResults');
const { parseFailedMetrics } = require('../lib/gate');
const { toDateString } = require('../lib/runDate');

// CI/CD callers hit this with an API key, never a Cognito token (see the
// gate-check Events.Auth override in template.yaml: Authorizer: NONE,
// ApiKeyRequired: true). Deliberately does NOT call getIdentity and does NOT
// read event.requestContext at all -- there may be no requestContext.authorizer
// on this route, and even when Cognito claims happen to be present they must
// not affect this response.
async function gateCheckRoute(req, conn) {
  const releaseId = req.pathParams.id;
  const release = await getRelease(conn, releaseId);
  if (!release) return notFound('Release not found');

  const gateRow = await getLatestGateResult(conn, releaseId);
  if (!gateRow) {
    return ok({
      release_id: releaseId,
      project_id: release.project_id,
      status: 'unknown',
      run_date: null,
      evaluated_at: null,
      failed_metrics: [],
    });
  }

  const failed_metrics = parseFailedMetrics(gateRow.failed_metrics).map((m) => m.metric_type);
  return ok({
    release_id: releaseId,
    project_id: release.project_id,
    status: gateRow.status,
    run_date: toDateString(gateRow.run_date),
    evaluated_at: gateRow.evaluated_at,
    failed_metrics,
  });
}

// Cognito-authenticated. No group restriction -- any signed-in user may view
// gate status. getIdentity is called only to emit a structured access log line.
async function gateStatusRoute(req, conn) {
  const identity = getIdentity(req.event);
  const releaseId = req.pathParams.id;
  console.log(JSON.stringify({
    level: 'info', msg: 'gate-status accessed', user: identity.email || identity.sub, release_id: releaseId,
  }));

  const release = await getRelease(conn, releaseId);
  if (!release) return notFound('Release not found');

  const gateRow = await getLatestGateResult(conn, releaseId);
  const status = gateRow ? gateRow.status : 'unknown';
  const failed_metrics = gateRow ? parseFailedMetrics(gateRow.failed_metrics) : [];

  return ok({
    release: {
      release_id: release.release_id,
      project_id: release.project_id,
      release_name: release.release_name,
      status: release.status,
      target_date: toDateString(release.target_date),
    },
    status,
    failed_metrics,
    run_date: gateRow ? toDateString(gateRow.run_date) : null,
    evaluated_at: gateRow ? gateRow.evaluated_at : null,
  });
}

exports.handler = createApiHandler({
  'GET /releases/{id}/gate-status': gateStatusRoute,
  'GET /releases/{id}/gate-check': gateCheckRoute,
});

module.exports.gateCheckRoute = gateCheckRoute;
module.exports.gateStatusRoute = gateStatusRoute;
