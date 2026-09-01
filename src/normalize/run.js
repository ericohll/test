// Shared normalize logic for all five normalize-<tool> Lambdas
// (template.yaml lines 299-387). Each handler file just re-exports
// `handler` below; TOOL differentiates them at runtime via env.
//
// D7 batch-status sequence, deliberately split across separate DB calls so a
// rolled-back transaction never erases the status update that reports on it:
//   1. withConnection: upsertProject, upsertBatch(status: 'ingested')  -- autocommitted
//   2. withTransaction: ensureOpenRelease -> upsertMetric* -> upsertFinding* -> markBatchStatus('normalized')
//   3. catch: separate withConnection -> markBatchStatus('failed', err.message), rethrow

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { withConnection, withTransaction } = require('../lib/db');
const { batchKey: computeBatchKey, s3RawKey: computeS3RawKey } = require('../lib/ids');
const { toMysqlDatetime } = require('../lib/runDate');
const { truncate } = require('../parsers/common');
const projectsRepo = require('../repo/projects');
const releasesRepo = require('../repo/releases');
const batchesRepo = require('../repo/batches');
const metricsRepo = require('../repo/metrics');
const findingsRepo = require('../repo/findings');
const ids = require('../lib/ids');

const PARSERS = {
  sonarqube: require('../parsers/sonarqube'),
  gitlab: require('../parsers/gitlab'),
  fortify: require('../parsers/fortify'),
  trivy: require('../parsers/trivy'),
  tricentis: require('../parsers/tricentis'),
};

const s3 = new S3Client({});

function log(level, fields) {
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    JSON.stringify({ level, ...fields })
  );
}

async function fetchEnvelope(s3Key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: process.env.DATA_LAKE_BUCKET, Key: s3Key }));
  const text = await res.Body.transformToString();
  return JSON.parse(text);
}

async function normalizeMessage(msg) {
  const { tool, project_id, run_date } = msg;
  if (!tool || !project_id || !run_date || !msg.s3_key || !msg.batch_key) {
    throw new Error(`normalize: message missing required fields: ${JSON.stringify(msg)}`);
  }

  const parser = PARSERS[tool];
  if (!parser) throw new Error(`normalize: no parser registered for tool "${tool}"`);

  // The message's batch_key/s3_key are recomputed from the deterministic
  // formulas in src/lib/ids.js and trusted over whatever the message
  // actually carried -- they are the source of truth a replay must agree
  // with, and disagreement here would indicate a bug upstream, not data to
  // propagate.
  const batch_key = computeBatchKey(tool, project_id, run_date);
  const s3_key = computeS3RawKey(tool, project_id, run_date);
  if (batch_key !== msg.batch_key || s3_key !== msg.s3_key) {
    log('warn', {
      tool, project_id, run_date,
      message: 'recomputed batch_key/s3_key disagree with the SQS message; using recomputed values',
      message_batch_key: msg.batch_key, message_s3_key: msg.s3_key, batch_key, s3_key,
    });
  }

  // Step 1 (D7): upsert project + batch row, autocommitted -- normalize is
  // the only side of ingestion with DB access (the ingest Lambdas' IAM
  // roles have no rds-db:connect grant), so this is also where the
  // ingestion_batches row for this batch first comes into existence. This
  // happens before the S3 fetch/parse below (deliberately: it needs only
  // the SQS message, not the envelope) so that a failure anywhere after
  // this point -- including a failed S3 GetObject -- always has a batch row
  // already in place for the catch block to mark 'failed'.
  await withConnection(async (conn) => {
    await projectsRepo.upsertProject(conn, {
      project_id,
      name: msg.project_name || project_id,
      repo_url: msg.repo_url || null,
    });

    const existingBatch = await batchesRepo.getBatch(conn, batch_key);
    if (existingBatch) {
      log('info', {
        tool, project_id, run_date, batch_key,
        message: 'replaying an existing batch',
        replay: true,
        attempt_count: existingBatch.attempt_count + 1,
      });
    }

    await batchesRepo.upsertBatch(conn, {
      batch_key, tool, project_id, run_date, s3_path: s3_key, status: 'ingested',
    });
  });

  try {
    const envelope = await fetchEnvelope(s3_key);
    const seen_at = toMysqlDatetime(envelope.fetched_at || new Date().toISOString());
    const raw_ref = s3_key;
    const { metrics, findings } = parser.parse(envelope);

    await withTransaction(async (conn) => {
      const release = await releasesRepo.ensureOpenRelease(conn, project_id);

      for (const m of metrics) {
        await metricsRepo.upsertMetric(conn, {
          project_id, tool, run_date, metric_type: m.metric_type,
          release_id: release.release_id, value: m.value, unit: m.unit, batch_key,
        });
      }

      for (const f of findings) {
        const finding_id = ids.findingId(tool, project_id, f.external_finding_id);
        await findingsRepo.upsertFinding(conn, {
          finding_id,
          tool,
          project_id,
          external_finding_id: f.external_finding_id,
          title: truncate(f.title, 512),
          severity: f.severity,
          status: f.status,
          seen_at,
          run_date,
          raw_ref,
        }, batch_key);
      }

      await batchesRepo.markBatchStatus(conn, batch_key, 'normalized');
    });

    log('info', {
      tool, project_id, run_date, batch_key,
      message: 'normalize complete', metrics: metrics.length, findings: findings.length,
    });

    return { batch_key, metrics: metrics.length, findings: findings.length };
  } catch (err) {
    await withConnection((conn) => batchesRepo.markBatchStatus(conn, batch_key, 'failed', err.message));
    throw err;
  }
}

async function handler(event) {
  const tool = process.env.TOOL;
  const errors = [];

  for (const record of (event && event.Records) || []) {
    let body;
    try {
      body = JSON.parse(record.body);
    } catch (err) {
      errors.push(err);
      log('error', { message: 'unparseable SQS record body', error: err.message });
      continue;
    }

    if (body.tool !== tool) {
      log('warn', {
        tool, message: 'skipping record for a different tool', record_tool: body.tool, run_date: body.run_date,
      });
      continue;
    }

    try {
      await normalizeMessage(body);
    } catch (err) {
      errors.push(err);
      log('error', {
        tool, project_id: body.project_id, run_date: body.run_date, batch_key: body.batch_key,
        message: 'normalize failed', error: err.message,
      });
    }
  }

  if (errors.length > 0) {
    // template.yaml does not set FunctionResponseTypes: ReportBatchItemFailures,
    // so a partial failure here retries the whole SQS batch. That is safe
    // because every normalize step is idempotent (D6) -- see README.md for
    // the note that per-record retry would need a template.yaml change,
    // which is out of scope here.
    throw new Error(`normalize: ${errors.length} record(s) failed: ${errors.map((e) => e.message).join('; ')}`);
  }
}

module.exports = { handler, normalizeMessage };
