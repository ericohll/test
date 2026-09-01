async function getFindingById(conn, findingId) {
  const [rows] = await conn.execute('SELECT * FROM findings WHERE finding_id = ?', [findingId]);
  return rows[0] || null;
}

// Upsert a finding by its deterministic finding_id and append a lifecycle event.
// source_run makes the lifecycle insert idempotent under batch replay (INSERT IGNORE
// on the (finding_id, source_run, event_type) unique key).
async function upsertFinding(conn, finding, sourceRun) {
  const { finding_id, tool, project_id, external_finding_id, title, severity, status, seen_at, run_date, raw_ref } = finding;
  const existing = await getFindingById(conn, finding_id);

  // Retrying the same normalize run after a partial failure must not re-emit
  // lifecycle events for a finding this exact run already processed.
  if (existing && existing.last_run_date === run_date) return;

  if (!existing) {
    await conn.execute(
      `INSERT INTO findings
         (finding_id, tool, project_id, external_finding_id, title, severity, status,
          first_seen, last_seen, last_run_date, raw_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [finding_id, tool, project_id, external_finding_id, title || null, severity, status,
        seen_at, seen_at, run_date, raw_ref || null]
    );
    await conn.execute(
      `INSERT IGNORE INTO finding_lifecycle_events (finding_id, event_type, event_ts, source_run, detail)
       VALUES (?, 'created', ?, ?, ?)`,
      [finding_id, seen_at, sourceRun, JSON.stringify({ severity, status })]
    );
    return;
  }

  await conn.execute(
    `UPDATE findings SET title = ?, severity = ?, status = ?, last_seen = ?, last_run_date = ?, raw_ref = ?
     WHERE finding_id = ?`,
    [title || existing.title, severity, status, seen_at, run_date, raw_ref || existing.raw_ref, finding_id]
  );

  // Exactly one lifecycle event per run, in priority order: a status
  // transition matters most, then a severity change, else a plain sighting.
  if (existing.status !== status) {
    const eventType = status === 'resolved' ? 'resolved' : status === 'reopened' ? 'reopened' : 'status_changed';
    await conn.execute(
      `INSERT IGNORE INTO finding_lifecycle_events (finding_id, event_type, event_ts, source_run, detail)
       VALUES (?, ?, ?, ?, ?)`,
      [finding_id, eventType, seen_at, sourceRun, JSON.stringify({ from: existing.status, to: status })]
    );
  } else if (existing.severity !== severity) {
    await conn.execute(
      `INSERT IGNORE INTO finding_lifecycle_events (finding_id, event_type, event_ts, source_run, detail)
       VALUES (?, 'severity_changed', ?, ?, ?)`,
      [finding_id, seen_at, sourceRun, JSON.stringify({ from: existing.severity, to: severity })]
    );
  } else {
    await conn.execute(
      `INSERT IGNORE INTO finding_lifecycle_events (finding_id, event_type, event_ts, source_run, detail)
       VALUES (?, 'seen', ?, ?, ?)`,
      [finding_id, seen_at, sourceRun, JSON.stringify({})]
    );
  }
}

async function listFindings(conn, { project_id, status, severity, limit = 50, offset = 0 }) {
  const clauses = [];
  const params = [];
  if (project_id) { clauses.push('project_id = ?'); params.push(project_id); }
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (severity) { clauses.push('severity = ?'); params.push(severity); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await conn.query(
    `SELECT * FROM findings ${where} ORDER BY last_seen DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );
  return rows;
}

// "Open" for dashboard/portfolio purposes excludes resolved and false_positive.
// projectId === null rolls this up across every project (for the portfolio summary).
async function countOpenFindingsBySeverity(conn, projectId = null) {
  const clauses = ["status IN ('open','confirmed','reopened')"];
  const params = [];
  if (projectId) {
    clauses.push('project_id = ?');
    params.push(projectId);
  }
  const [rows] = await conn.execute(
    `SELECT project_id, severity, COUNT(*) AS cnt
     FROM findings
     WHERE ${clauses.join(' AND ')}
     GROUP BY project_id, severity`,
    params
  );
  return rows.map((r) => ({ project_id: r.project_id, severity: r.severity, count: Number(r.cnt) }));
}

module.exports = { getFindingById, upsertFinding, listFindings, countOpenFindingsBySeverity };
