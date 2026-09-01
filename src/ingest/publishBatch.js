// Writes the D2 S3 envelope for one (tool, project, run_date) and enqueues
// the SQS message that drives normalize. Module-scope clients are safe to
// share across invocations (and to stub with aws-sdk-client-mock, which
// patches Client.prototype.send).

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { s3RawKey, batchKey } = require('../lib/ids');

const s3 = new S3Client({});
const sqs = new SQSClient({});

async function publishBatch({ tool, project, runDate, payload, source }) {
  const key = s3RawKey(tool, project.project_id, runDate);
  const bk = batchKey(tool, project.project_id, runDate);

  const envelope = {
    envelope_version: 1,
    tool,
    project_id: project.project_id,
    run_date: runDate,
    fetched_at: new Date().toISOString(),
    source: source || {},
    payload,
  };

  await s3.send(new PutObjectCommand({
    Bucket: process.env.DATA_LAKE_BUCKET,
    Key: key,
    Body: JSON.stringify(envelope),
    ContentType: 'application/json',
  }));

  // `tool` must stay a top-level string field: it's what the SQS event
  // source FilterCriteria `{"body":{"tool":["<tool>"]}}` in template.yaml
  // matches on to route each message to its tool-specific normalize Lambda.
  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.INGEST_QUEUE_URL,
    MessageBody: JSON.stringify({
      tool,
      project_id: project.project_id,
      project_name: project.name,
      repo_url: project.repo_url || null,
      run_date: runDate,
      s3_key: key,
      batch_key: bk,
    }),
  }));

  return { project_id: project.project_id, batch_key: bk, s3_key: key };
}

module.exports = { publishBatch };
