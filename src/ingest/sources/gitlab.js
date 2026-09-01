const { getJson, getPaged } = require('../httpJson');

const PAGE_SIZE = 100;

async function fetchProject({ secret, project, runDate }) { // eslint-disable-line no-unused-vars
  const headers = { 'PRIVATE-TOKEN': secret.token };
  const baseUrl = secret.baseUrl.replace(/\/$/, '');
  const id = project.gitlabProjectId;

  const glProject = await getJson(`${baseUrl}/api/v4/projects/${id}`, headers);

  const mergeRequests = await getPaged(
    (page) => `${baseUrl}/api/v4/projects/${id}/merge_requests?state=opened&per_page=${PAGE_SIZE}&page=${page}`,
    headers,
    { extract: (json) => json }
  );

  const pipelines = await getPaged(
    (page) => `${baseUrl}/api/v4/projects/${id}/pipelines?per_page=${PAGE_SIZE}&page=${page}`,
    headers,
    { extract: (json) => json }
  );

  const vulnerabilityFindings = await getPaged(
    (page) => `${baseUrl}/api/v4/projects/${id}/vulnerability_findings?per_page=${PAGE_SIZE}&page=${page}`,
    headers,
    { extract: (json) => json }
  );

  return {
    payload: {
      project: glProject,
      merge_requests: mergeRequests,
      pipelines,
      vulnerability_findings: vulnerabilityFindings,
    },
    project_name: glProject.name || project.name,
    repo_url: glProject.web_url,
    source: { baseUrl, gitlabProjectId: id },
  };
}

module.exports = { fetchProject };
