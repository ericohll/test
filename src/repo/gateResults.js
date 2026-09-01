async function upsertGateResult(conn, { release_id, project_id, run_date, status, failed_metrics }) {
  await conn.execute(
    `INSERT INTO gate_results (release_id, project_id, run_date, status, failed_metrics)
     VALUES (?, ?, ?, ?, ?) AS new
     ON DUPLICATE KEY UPDATE
       status = new.status,
       failed_metrics = new.failed_metrics,
       evaluated_at = CURRENT_TIMESTAMP(3)`,
    [release_id, project_id, run_date, status, JSON.stringify(failed_metrics || [])]
  );
}

async function getLatestGateResult(conn, releaseId) {
  const [rows] = await conn.execute(
    'SELECT * FROM gate_results WHERE release_id = ? ORDER BY run_date DESC, gate_result_id DESC LIMIT 1',
    [releaseId]
  );
  return rows[0] || null;
}

module.exports = { upsertGateResult, getLatestGateResult };
