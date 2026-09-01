const { createApiHandler, ValidationError, requiredString, requiredNumber } = require('../lib/apiHandler');
const { ok, forbidden, notFound } = require('../lib/http');
const { getIdentity, hasAnyGroup, WRITE_GROUPS } = require('../lib/auth');
const { getProject } = require('../repo/projects');
const { getCurrentThreshold, insertThresholdVersion } = require('../repo/thresholds');
const { logAction } = require('../repo/userActions');
const { OPERATORS } = require('../lib/operators');

function requiredGroups() {
  const raw = process.env.REQUIRED_GROUPS;
  if (!raw) return WRITE_GROUPS;
  return raw.split(',').map((g) => g.trim()).filter(Boolean);
}

// Group membership is checked before any body validation or DB lookup, so an
// unauthorized caller learns nothing about whether the project/body are
// otherwise valid.
async function putThresholdRoute(req, conn) {
  const identity = getIdentity(req.event);
  const groups = requiredGroups();
  if (!hasAnyGroup(identity, groups)) {
    return forbidden(`Requires one of the following groups: ${groups.join(', ')}`);
  }

  const metric_type = requiredString(req.body, 'metric_type');
  const operator = requiredString(req.body, 'operator');
  if (!OPERATORS.includes(operator)) {
    throw new ValidationError(`operator must be one of: ${OPERATORS.join(', ')}`);
  }
  const threshold_value = requiredNumber(req.body, 'threshold_value');

  const projectId = req.pathParams.id;
  const project = await getProject(conn, projectId);
  if (!project) return notFound('Project not found');

  const previous = await getCurrentThreshold(conn, projectId, metric_type);

  const updated_by = identity.email;
  const row = await insertThresholdVersion(conn, {
    project_id: projectId, metric_type, operator, threshold_value, updated_by,
  });

  await logAction(conn, {
    user_id: identity.sub,
    action_type: 'threshold_update',
    target_ref: `project:${projectId}:${metric_type}`,
    detail: {
      previous: previous
        ? { operator: previous.operator, threshold_value: Number(previous.threshold_value) }
        : null,
      next: { operator, threshold_value },
    },
  });

  return ok({
    threshold: {
      metric_type: row.metric_type,
      operator: row.operator,
      threshold_value: Number(row.threshold_value),
      updated_by: row.updated_by,
      updated_at: row.updated_at,
    },
  });
}

exports.handler = createApiHandler({
  'PUT /projects/{id}/thresholds': { handle: putThresholdRoute, tx: true },
});

module.exports.putThresholdRoute = putThresholdRoute;
