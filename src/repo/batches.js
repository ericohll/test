async function upsertBatch(conn, { batch_key, tool, project_id, run_date, s3_path, status }) {
  await conn.execute(
    `INSERT INTO ingestion_batches (batch_key, tool, project_id, run_date, s3_path, status)
     VALUES (?, ?, ?, ?, ?, ?) AS new
     ON DUPLICATE KEY UPDATE
       s3_path = new.s3_path,
       status = new.status,
       attempt_count = ingestion_batches.attempt_count + 1`,
    [batch_key, tool, project_id, run_date, s3_path, status || 'pending']
  );
}

async function markBatchStatus(conn, batchKey, status, errorMessage) {
  await conn.execute(
    'UPDATE ingestion_batches SET status = ?, error_message = ? WHERE batch_key = ?',
    [status, errorMessage || null, batchKey]
  );
}

async function getBatch(conn, batchKey) {
  const [rows] = await conn.execute('SELECT * FROM ingestion_batches WHERE batch_key = ?', [batchKey]);
  return rows[0] || null;
}

module.exports = { upsertBatch, markBatchStatus, getBatch };
