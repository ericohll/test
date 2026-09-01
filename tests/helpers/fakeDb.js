// Minimal in-memory stand-in for a mysql2/promise connection, covering exactly
// the query shapes used by src/repo/*.js. Not a general SQL engine -- it
// pattern-matches on distinctive substrings of each known statement and
// enforces the same PK / unique-key / append-only semantics as
// db/migrations/001_init.sql, so repo tests catch schema/behavior drift.

function norm(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

// Real result sets are snapshots, not live references into storage -- clone
// on every read so a later UPDATE can't retroactively mutate a row a caller
// already fetched and is still comparing against.
function clone(row) {
  return row ? { ...row } : row;
}

function createFakeDb() {
  const tables = {
    projects: new Map(),
    releases: new Map(),
    ingestion_batches: new Map(),
    metrics: new Map(), // key: project_id|tool|run_date|metric_type
    findings: new Map(),
    finding_lifecycle_events: [],
    thresholds: [],
    gate_results: new Map(), // key: release_id|run_date
    user_actions: [],
  };
  let thresholdSeq = 0;
  let gateResultSeq = 0;

  async function execute(sql, params = []) {
    const s = norm(sql);

    // ---- projects ----
    if (s.startsWith('INSERT INTO projects')) {
      const [project_id, name, repo_url] = params;
      tables.projects.set(project_id, { project_id, name, repo_url });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith('SELECT * FROM projects WHERE project_id')) {
      const [project_id] = params;
      const row = tables.projects.get(project_id);
      return [row ? [clone(row)] : []];
    }
    if (s.startsWith('SELECT * FROM projects ORDER BY name')) {
      return [[...tables.projects.values()].sort((a, b) => a.name.localeCompare(b.name)).map(clone)];
    }

    // ---- releases ----
    if (s.includes("FROM releases WHERE project_id = ? AND status = 'open'")) {
      const [project_id] = params;
      const row = [...tables.releases.values()].find((r) => r.project_id === project_id && r.status === 'open');
      return [row ? [clone(row)] : []];
    }
    if (s.startsWith('SELECT * FROM releases WHERE release_id')) {
      const [release_id] = params;
      const row = tables.releases.get(release_id);
      return [row ? [clone(row)] : []];
    }
    if (s.startsWith('INSERT INTO releases')) {
      const [release_id, project_id, release_name, target_date] = params;
      const openMarkerConflict = [...tables.releases.values()].some(
        (r) => r.project_id === project_id && r.status === 'open'
      );
      if (openMarkerConflict) {
        const err = new Error('Duplicate entry for key uq_releases_one_open_per_project');
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      tables.releases.set(release_id, {
        release_id, project_id, release_name, target_date: target_date || null, status: 'open',
      });
      return [{ affectedRows: 1 }];
    }

    // ---- ingestion_batches ----
    if (s.startsWith('INSERT INTO ingestion_batches')) {
      const [batch_key, tool, project_id, run_date, s3_path, status] = params;
      const existing = tables.ingestion_batches.get(batch_key);
      tables.ingestion_batches.set(batch_key, {
        batch_key, tool, project_id, run_date, s3_path, status,
        attempt_count: existing ? existing.attempt_count + 1 : 1,
        error_message: existing ? existing.error_message : null,
      });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith('UPDATE ingestion_batches SET status')) {
      const [status, error_message, batch_key] = params;
      const row = tables.ingestion_batches.get(batch_key);
      if (row) { row.status = status; row.error_message = error_message; }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (s.startsWith('SELECT * FROM ingestion_batches WHERE batch_key')) {
      const [batch_key] = params;
      const row = tables.ingestion_batches.get(batch_key);
      return [row ? [clone(row)] : []];
    }

    // ---- metrics ----
    if (s.startsWith('INSERT INTO metrics')) {
      const [project_id, tool, run_date, metric_type, release_id, value, unit, batch_key] = params;
      const key = `${project_id}|${tool}|${run_date}|${metric_type}`;
      const existing = tables.metrics.get(key);
      const metric_id = existing ? existing.metric_id : tables.metrics.size + 1;
      tables.metrics.set(key, { metric_id, project_id, tool, run_date, metric_type, release_id, value, unit, batch_key });
      return [{ affectedRows: 1 }];
    }
    if (s.includes('FROM metrics m') && s.includes('JOIN')) {
      const [project_id] = params;
      const rowsForProject = [...tables.metrics.values()].filter((m) => m.project_id === project_id);
      const latestByType = new Map();
      for (const m of rowsForProject) {
        const cur = latestByType.get(m.metric_type);
        if (!cur || m.run_date > cur.run_date) latestByType.set(m.metric_type, m);
      }
      return [[...latestByType.values()].map(clone)];
    }
    if (s.startsWith('SELECT * FROM metrics WHERE release_id')) {
      const [release_id] = params;
      return [[...tables.metrics.values()].filter((m) => m.release_id === release_id).map(clone)];
    }

    // ---- findings ----
    if (s.includes('FROM findings WHERE status IN') && s.includes('GROUP BY')) {
      let rows = [...tables.findings.values()].filter((r) => ['open', 'confirmed', 'reopened'].includes(r.status));
      if (s.includes('AND project_id = ?')) {
        const [project_id] = params;
        rows = rows.filter((r) => r.project_id === project_id);
      }
      const byKey = new Map();
      for (const r of rows) {
        const key = `${r.project_id}|${r.severity}`;
        byKey.set(key, (byKey.get(key) || 0) + 1);
      }
      const result = [...byKey.entries()].map(([key, cnt]) => {
        const [project_id, severity] = key.split('|');
        return { project_id, severity, cnt };
      });
      return [result];
    }
    if (s.startsWith('SELECT * FROM findings WHERE finding_id')) {
      const [finding_id] = params;
      const row = tables.findings.get(finding_id);
      return [row ? [clone(row)] : []];
    }
    if (s.startsWith('INSERT INTO findings')) {
      const [finding_id, tool, project_id, external_finding_id, title, severity, status,
        first_seen, last_seen, last_run_date, raw_ref] = params;
      tables.findings.set(finding_id, {
        finding_id, tool, project_id, external_finding_id, title, severity, status,
        first_seen, last_seen, last_run_date, raw_ref,
      });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith('UPDATE findings SET')) {
      const [title, severity, status, last_seen, last_run_date, raw_ref, finding_id] = params;
      const row = tables.findings.get(finding_id);
      if (row) Object.assign(row, { title, severity, status, last_seen, last_run_date, raw_ref });
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (s.startsWith('INSERT IGNORE INTO finding_lifecycle_events')) {
      // event_type is either a bound literal ('created' / 'seen') or a bound param
      // (severity_changed / status_changed / resolved / reopened), depending on call site.
      const literalMatch = s.match(/VALUES \(\?, '(\w+)', \?, \?, \?\)/);
      let fid, type, ts, src;
      if (literalMatch) {
        [fid, ts, src] = params;
        type = literalMatch[1];
      } else {
        [fid, type, ts, src] = params;
      }
      const key = `${fid}|${src}|${type}`;
      if (tables.finding_lifecycle_events.some((e) => e.key === key)) return [{ affectedRows: 0 }];
      tables.finding_lifecycle_events.push({ key, finding_id: fid, event_type: type, event_ts: ts, source_run: src });
      return [{ affectedRows: 1 }];
    }
    if (s.includes('FROM findings') && s.includes('ORDER BY last_seen DESC')) {
      let rows = [...tables.findings.values()];
      // params order: [...filters, limit, offset] -- filters correspond to WHERE clauses
      // present in the query text, applied positionally.
      let pi = 0;
      if (s.includes('project_id = ?')) { const v = params[pi++]; rows = rows.filter((r) => r.project_id === v); }
      if (s.includes('status = ?')) { const v = params[pi++]; rows = rows.filter((r) => r.status === v); }
      if (s.includes('severity = ?')) { const v = params[pi++]; rows = rows.filter((r) => r.severity === v); }
      rows = rows.sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1));
      const limit = params[pi++];
      const offset = params[pi++];
      return [rows.slice(offset, offset + limit).map(clone)];
    }

    // ---- thresholds (append-only, OED-03) ----
    if (s.startsWith('INSERT INTO thresholds')) {
      const [project_id, metric_type, operator, threshold_value, updated_by] = params;
      thresholdSeq += 1;
      tables.thresholds.push({
        threshold_id: thresholdSeq, project_id, metric_type, operator, threshold_value, updated_by,
        updated_at: new Date().toISOString(),
      });
      return [{ insertId: thresholdSeq, affectedRows: 1 }];
    }
    if (s.startsWith('SELECT * FROM thresholds WHERE threshold_id')) {
      const [threshold_id] = params;
      const row = tables.thresholds.find((t) => t.threshold_id === threshold_id);
      return [row ? [clone(row)] : []];
    }
    if (s.includes('ROW_NUMBER() OVER')) {
      const [project_id] = params;
      const byKey = new Map();
      for (const t of tables.thresholds.filter((r) => r.project_id === project_id)) {
        const k = `${t.project_id}|${t.metric_type}`;
        const cur = byKey.get(k);
        if (!cur || t.updated_at > cur.updated_at || (t.updated_at === cur.updated_at && t.threshold_id > cur.threshold_id)) {
          byKey.set(k, t);
        }
      }
      return [[...byKey.values()].map(clone)];
    }
    if (s.startsWith('SELECT * FROM thresholds WHERE project_id = ? AND metric_type')) {
      const [project_id, metric_type] = params;
      const rows = tables.thresholds
        .filter((t) => t.project_id === project_id && t.metric_type === metric_type)
        .sort((a, b) => (a.updated_at === b.updated_at ? b.threshold_id - a.threshold_id : (a.updated_at < b.updated_at ? 1 : -1)));
      return [rows.length ? [clone(rows[0])] : []];
    }

    // ---- gate_results ----
    if (s.startsWith('INSERT INTO gate_results')) {
      const [release_id, project_id, run_date, status, failed_metrics] = params;
      const key = `${release_id}|${run_date}`;
      gateResultSeq += 1;
      tables.gate_results.set(key, {
        gate_result_id: gateResultSeq, release_id, project_id, run_date, status,
        failed_metrics: JSON.parse(failed_metrics), evaluated_at: new Date().toISOString(),
      });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith('SELECT * FROM gate_results WHERE release_id')) {
      const [release_id] = params;
      const rows = [...tables.gate_results.values()]
        .filter((g) => g.release_id === release_id)
        .sort((a, b) => (a.run_date === b.run_date ? b.gate_result_id - a.gate_result_id : (a.run_date < b.run_date ? 1 : -1)));
      return [rows.length ? [clone(rows[0])] : []];
    }

    // ---- user_actions ----
    if (s.startsWith('INSERT INTO user_actions')) {
      const [user_id, action_type, target_ref, detail] = params;
      tables.user_actions.push({ user_id, action_type, target_ref, detail: JSON.parse(detail) });
      return [{ affectedRows: 1 }];
    }

    throw new Error(`fakeDb: unrecognized query: ${s}`);
  }

  return { execute, query: execute, _tables: tables };
}

module.exports = { createFakeDb };
