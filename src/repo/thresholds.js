// OED-03: thresholds is append-only version history. "Current" = row with the
// max updated_at, tied broken by max threshold_id, per (project_id, metric_type).
async function insertThresholdVersion(conn, { project_id, metric_type, operator, threshold_value, updated_by }) {
  const [result] = await conn.execute(
    `INSERT INTO thresholds (project_id, metric_type, operator, threshold_value, updated_by)
     VALUES (?, ?, ?, ?, ?)`,
    [project_id, metric_type, operator, threshold_value, updated_by]
  );
  const [rows] = await conn.execute('SELECT * FROM thresholds WHERE threshold_id = ?', [result.insertId]);
  return rows[0];
}

async function getCurrentThresholds(conn, projectId) {
  const [rows] = await conn.execute(
    `SELECT project_id, metric_type, operator, threshold_value, updated_by, updated_at FROM (
       SELECT t.*, ROW_NUMBER() OVER (
         PARTITION BY project_id, metric_type ORDER BY updated_at DESC, threshold_id DESC
       ) AS rn
       FROM thresholds t WHERE project_id = ?
     ) ranked WHERE rn = 1`,
    [projectId]
  );
  return rows;
}

async function getCurrentThreshold(conn, projectId, metricType) {
  const [rows] = await conn.execute(
    `SELECT * FROM thresholds WHERE project_id = ? AND metric_type = ?
     ORDER BY updated_at DESC, threshold_id DESC LIMIT 1`,
    [projectId, metricType]
  );
  return rows[0] || null;
}

module.exports = { insertThresholdVersion, getCurrentThresholds, getCurrentThreshold };
