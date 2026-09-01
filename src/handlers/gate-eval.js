// Nightly gate evaluation. Triggered as a Step Functions Task after the
// ingest/normalize branches complete; the incoming event (the Parallel
// state's output) carries no contract we rely on -- it is ignored entirely.

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { withConnection } = require('../lib/db');
const { today } = require('../lib/runDate');
const { listProjects } = require('../repo/projects');
const { ensureOpenRelease } = require('../repo/releases');
const { getCurrentThresholds } = require('../repo/thresholds');
const { getLatestMetricsForProject } = require('../repo/metrics');
const { upsertGateResult } = require('../repo/gateResults');
const { evaluateGate } = require('../lib/gate');

const sns = new SNSClient({});

async function publishBreach({ project, release, run_date, failed_metrics }) {
  const project_id = project.project_id;
  await sns.send(new PublishCommand({
    TopicArn: process.env.ALERTS_TOPIC_ARN,
    Subject: `Gate FAIL: ${project_id}`.slice(0, 99),
    Message: JSON.stringify({
      type: 'gate_breach',
      project_id,
      project_name: project.name,
      release_id: release.release_id,
      run_date,
      status: 'fail',
      failed_metrics,
      dashboard_url: `${process.env.APP_URL || ''}/projects/${encodeURIComponent(project_id)}`,
    }),
    MessageAttributes: {
      project_id: { DataType: 'String', StringValue: String(project_id) },
    },
  }));
}

exports.handler = async (event = {}) => { // eslint-disable-line no-unused-vars
  const run_date = today();

  return withConnection(async (conn) => {
    const projects = await listProjects(conn);
    const results = [];
    let passed = 0;
    let failed = 0;
    let unknown = 0;
    let errors = 0;

    // One connection (connectionLimit: 2, one handed out per withConnection call)
    // can't run queries in parallel -- evaluate projects sequentially, never
    // Promise.all.
    for (const p of projects) {
      try {
        const release = await ensureOpenRelease(conn, p.project_id);
        const thresholdRows = await getCurrentThresholds(conn, p.project_id);
        // "Latest row per metric_type for this project" (not release-scoped):
        // metrics.release_id is nullable, so this is the well-defined nightly state.
        const metricRows = await getLatestMetricsForProject(conn, p.project_id);
        const { status, failed_metrics, missing_metrics, thresholds_evaluated } = evaluateGate(metricRows, thresholdRows);

        await upsertGateResult(conn, {
          release_id: release.release_id,
          project_id: p.project_id,
          run_date,
          status,
          failed_metrics,
        });

        if (status === 'fail') {
          await publishBreach({ project: p, release, run_date, failed_metrics });
        }

        if (status === 'pass') passed += 1;
        else if (status === 'fail') failed += 1;
        else unknown += 1;

        results.push({
          project_id: p.project_id,
          release_id: release.release_id,
          status,
          failed_count: failed_metrics.length,
          missing_metrics,
          thresholds_evaluated,
        });
      } catch (err) {
        console.error(JSON.stringify({
          level: 'error', msg: 'gate eval failed for project', project_id: p.project_id, error: err.message,
        }));
        results.push({ project_id: p.project_id, status: 'error', error: err.message });
        errors += 1;
      }
    }

    const summary = { run_date, projects: results.length, passed, failed, unknown, errors, results };
    console.log(JSON.stringify({ level: 'info', msg: 'gate-eval summary', ...summary }));

    if (errors > 0) {
      const err = new Error(`gate-eval: ${errors} of ${results.length} projects failed`);
      err.summary = summary;
      throw err;
    }

    return summary;
  });
};

module.exports.publishBreach = publishBreach;
