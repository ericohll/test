async function getOpenReleaseForProject(conn, projectId) {
  const [rows] = await conn.execute(
    "SELECT * FROM releases WHERE project_id = ? AND status = 'open' LIMIT 1",
    [projectId]
  );
  return rows[0] || null;
}

async function getRelease(conn, releaseId) {
  const [rows] = await conn.execute('SELECT * FROM releases WHERE release_id = ?', [releaseId]);
  return rows[0] || null;
}

async function createRelease(conn, { release_id, project_id, release_name, target_date }) {
  await conn.execute(
    `INSERT INTO releases (release_id, project_id, release_name, target_date, status)
     VALUES (?, ?, ?, ?, 'open')`,
    [release_id, project_id, release_name, target_date || null]
  );
}

// Auto-creation rule: every project has at most one 'open' release at a time
// (enforced by the generated-column unique key on releases). Ingestion/gate-eval
// call this to get-or-create the current open release rather than requiring an
// operator to have cut one first.
async function ensureOpenRelease(conn, projectId) {
  const existing = await getOpenReleaseForProject(conn, projectId);
  if (existing) return existing;
  const release_id = `${projectId}-auto-${Date.now()}`;
  await createRelease(conn, {
    release_id,
    project_id: projectId,
    release_name: `${projectId} (auto)`,
  });
  return getRelease(conn, release_id);
}

module.exports = { getOpenReleaseForProject, getRelease, createRelease, ensureOpenRelease };
