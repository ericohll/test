async function upsertProject(conn, { project_id, name, repo_url }) {
  await conn.execute(
    `INSERT INTO projects (project_id, name, repo_url) VALUES (?, ?, ?) AS new
     ON DUPLICATE KEY UPDATE name = new.name, repo_url = new.repo_url`,
    [project_id, name, repo_url || null]
  );
}

async function getProject(conn, projectId) {
  const [rows] = await conn.execute('SELECT * FROM projects WHERE project_id = ?', [projectId]);
  return rows[0] || null;
}

async function listProjects(conn) {
  const [rows] = await conn.execute('SELECT * FROM projects ORDER BY name ASC');
  return rows;
}

module.exports = { upsertProject, getProject, listProjects };
