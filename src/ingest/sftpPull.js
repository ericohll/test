// Shared skeleton for the three SFTP-pull ingest Lambdas (fortify, trivy,
// tricentis). Per D3, the assumed drop format is JSON (no XML parser is
// available in the pinned dependency set); see README.md for the extension
// point if a real deployment lands FVDL/JUnit XML instead.

const SftpClient = require('ssh2-sftp-client');
const { getSecretJson } = require('../lib/secrets');
const { today } = require('../lib/runDate');
const { publishBatch } = require('./publishBatch');
const { isConfigured } = require('./apiPull');

async function runSftpIngest({ tool }) {
  const secretArn = process.env.TOOL_SECRET_ARN;
  const secret = await getSecretJson(secretArn);

  if (!isConfigured(secret)) {
    console.warn(JSON.stringify({ level: 'warn', tool, message: 'tool secret not configured; skipping ingest' }));
    return { tool, run_date: today(), ingested: 0, skipped: 'not configured' };
  }

  const runDate = today();
  const batches = [];
  const failures = [];
  const client = new SftpClient();

  await client.connect({
    host: secret.host,
    port: secret.port || 22,
    username: secret.username,
    privateKey: secret.privateKey,
    passphrase: secret.passphrase,
  });

  try {
    for (const project of secret.projects) {
      try {
        const buf = await client.get(project.remotePath);
        const payload = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : buf);
        const result = await publishBatch({
          tool,
          project: { project_id: project.project_id, name: project.name, repo_url: project.repo_url },
          runDate,
          payload,
          source: { host: secret.host, remotePath: project.remotePath },
        });
        batches.push(result);
      } catch (err) {
        console.error(JSON.stringify({ level: 'error', tool, project_id: project.project_id, error: err.message }));
        failures.push({ project_id: project.project_id, error: err.message });
      }
    }
  } finally {
    await client.end();
  }

  if (failures.length > 0 && failures.length === secret.projects.length) {
    throw new Error(`${tool} ingest: all ${failures.length} project(s) failed; first error: ${failures[0].error}`);
  }

  return { tool, run_date: runDate, ingested: batches.length, failed: failures.length, batches, failures };
}

module.exports = { runSftpIngest };
