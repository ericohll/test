async function upsertMetric(conn, { project_id, tool, run_date, metric_type, release_id, value, unit, batch_key }) {
  await conn.execute(
    `INSERT INTO metrics (project_id, tool, run_date, metric_type, release_id, value, unit, batch_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new
     ON DUPLICATE KEY UPDATE
       release_id = new.release_id,
       value = new.value,
       unit = new.unit,
       batch_key = new.batch_key`,
    [project_id, tool, run_date, metric_type, release_id || null, value, unit || null, batch_key || null]
  );
}

// Latest value per metric_type for a project (most recent run_date wins).
async function getLatestMetricsForProject(conn, projectId) {
  const [rows] = await conn.execute(
    `SELECT m.* FROM metrics m
     JOIN (
       SELECT metric_type, MAX(run_date) AS max_run_date
       FROM metrics WHERE project_id = ? GROUP BY metric_type
     ) latest ON latest.metric_type = m.metric_type AND latest.max_run_date = m.run_date
     WHERE m.project_id = ?`,
    [projectId, projectId]
  );
  return rows;
}

async function getMetricsForRelease(conn, releaseId) {
  const [rows] = await conn.execute('SELECT * FROM metrics WHERE release_id = ?', [releaseId]);
  return rows;
}

module.exports = { upsertMetric, getLatestMetricsForProject, getMetricsForRelease };
