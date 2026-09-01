const { getJson, getPaged } = require('../httpJson');

const PAGE_SIZE = 500;
const METRIC_KEYS = 'coverage,duplicated_lines_density,bugs,code_smells,sqale_index';

async function fetchProject({ secret, project, runDate }) { // eslint-disable-line no-unused-vars
  const headers = { Authorization: `Bearer ${secret.token}` };
  const baseUrl = secret.baseUrl.replace(/\/$/, '');
  const key = project.sonarProjectKey;

  const measures = await getJson(
    `${baseUrl}/api/measures/component?component=${encodeURIComponent(key)}&metricKeys=${METRIC_KEYS}`,
    headers
  );

  const issues = await getPaged(
    (page) => `${baseUrl}/api/issues/search?componentKeys=${encodeURIComponent(key)}&ps=${PAGE_SIZE}&p=${page}`,
    headers,
    { extract: (json) => json.issues }
  );

  return {
    payload: { measures, issues },
    project_name: project.name,
    repo_url: project.repo_url,
    source: { baseUrl, sonarProjectKey: key },
  };
}

module.exports = { fetchProject };
