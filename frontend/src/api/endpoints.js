import { get, put, post, normaliseList } from './client.js';

export function listProjects() {
  return get('/projects').then((payload) => normaliseList(payload, 'projects'));
}

// Memoised for the pickers on the Findings and Threshold forms, so
// switching filters doesn't re-fetch the project list on every render.
let projectsCache = null;
export function listProjectsCached() {
  if (!projectsCache) {
    projectsCache = listProjects().catch((err) => {
      projectsCache = null;
      throw err;
    });
  }
  return projectsCache;
}

export function getProjectDashboard(projectId) {
  return get(`/projects/${encodeURIComponent(projectId)}/dashboard`);
}

export function getPortfolioSummary(top = 20) {
  return get('/portfolio/summary', { top });
}

export function listFindings({ projectId, status, severity, limit = 25, offset = 0 } = {}) {
  return get('/findings', {
    project_id: projectId,
    status,
    severity,
    limit,
    offset,
  }).then((payload) => ({
    items: normaliseList(payload, 'findings'),
    raw: payload,
  }));
}

export function getGateStatus(releaseId) {
  return get(`/releases/${encodeURIComponent(releaseId)}/gate-status`);
}

export function putThreshold(projectId, { metric_type, operator, threshold_value }) {
  return put(`/projects/${encodeURIComponent(projectId)}/thresholds`, {
    metric_type,
    operator,
    threshold_value,
  });
}

export function subscribeToProject({ project_id, email }) {
  // Deliberate superset: spec/design.md documents { project_id, channel,
  // target } while the task contract documents { project_id, email }. This
  // covers both without knowing which one the deployed handler expects
  // (see README "Known contract gaps").
  return post('/notifications/subscriptions', {
    project_id,
    email,
    channel: 'email',
    target: email,
  });
}

// Deliberately NOT implemented: GET /releases/{id}/gate-check. That route
// is authorized via API key for CI/CD callers (see template.yaml's
// ApiReleasesFunction GateCheck event, Auth: { Authorizer: NONE,
// ApiKeyRequired: true }) — a browser bundle must never hold that key.
