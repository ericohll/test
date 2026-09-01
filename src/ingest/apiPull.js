// Shared skeleton for the two API-pull ingest Lambdas (sonarqube, gitlab).
// The tool-specific HTTP calls live in src/ingest/sources/<tool>.js and are
// injected as `fetchProject`; this module only owns secret loading, project
// discovery (D1), per-project error isolation, and publishing to S3/SQS.

const { getSecretJson } = require('../lib/secrets');
const { today } = require('../lib/runDate');
const { publishBatch } = require('./publishBatch');

// The tool secret ships as {"token":"REPLACE_ME","baseUrl":"REPLACE_ME"} with
// no `projects` array until an operator configures it. Treat that as "not
// configured yet" and resolve successfully so the first nightly run after a
// fresh deploy doesn't fail the whole Step Functions pipeline.
function isConfigured(secret) {
  if (!secret || !Array.isArray(secret.projects) || secret.projects.length === 0) return false;
  if (secret.token === 'REPLACE_ME' || secret.baseUrl === 'REPLACE_ME') return false;
  return true;
}

async function runApiIngest({ tool, fetchProject }) {
  const secretArn = process.env.TOOL_SECRET_ARN;
  const secret = await getSecretJson(secretArn);

  if (!isConfigured(secret)) {
    console.warn(JSON.stringify({ level: 'warn', tool, message: 'tool secret not configured; skipping ingest' }));
    return { tool, run_date: today(), ingested: 0, skipped: 'not configured' };
  }

  const runDate = today();
  const batches = [];
  const failures = [];

  for (const project of secret.projects) {
    try {
      const { payload, project_name, repo_url, source } = await fetchProject({ secret, project, runDate });
      const result = await publishBatch({
        tool,
        project: { project_id: project.project_id, name: project_name || project.name, repo_url },
        runDate,
        payload,
        source,
      });
      batches.push(result);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', tool, project_id: project.project_id, error: err.message }));
      failures.push({ project_id: project.project_id, error: err.message });
    }
  }

  if (failures.length > 0 && failures.length === secret.projects.length) {
    throw new Error(`${tool} ingest: all ${failures.length} project(s) failed; first error: ${failures[0].error}`);
  }

  return { tool, run_date: runDate, ingested: batches.length, failed: failures.length, batches, failures };
}

module.exports = { runApiIngest, isConfigured };
