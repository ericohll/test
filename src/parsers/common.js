// Shared helpers for the tool parsers (src/parsers/{sonarqube,gitlab,fortify,trivy,tricentis}.js).
// Kept dependency-free and pure: every function here is a plain data
// transform with no I/O, so it is trivially unit-testable and safe to call
// from any parser without side effects.

const crypto = require('crypto');

// Must match the ENUM values in db/migrations/001_init.sql exactly.
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const STATUSES = ['open', 'confirmed', 'resolved', 'false_positive', 'reopened'];

// Case-insensitive lookup into a mapping table, e.g. mapFrom({BLOCKER:'critical'}, 'blocker', 'info').
function mapFrom(table, value, fallback) {
  if (value == null) return fallback;
  const needle = String(value).toLowerCase();
  for (const key of Object.keys(table)) {
    if (key.toLowerCase() === needle) return table[key];
  }
  return fallback;
}

function assertSeverity(v) {
  if (!SEVERITIES.includes(v)) throw new Error(`Invalid severity (not in ENUM): ${v}`);
  return v;
}

function assertStatus(v) {
  if (!STATUSES.includes(v)) throw new Error(`Invalid status (not in ENUM): ${v}`);
  return v;
}

// Tolerant numeric coercion -- SonarQube measures arrive as strings, some
// tool fields may be missing/null entirely.
function num(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Percentage rounded to 2dp; null (never NaN/0) when the denominator is empty
// so callers can omit the metric entirely rather than reporting a false 0%.
function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 10000) / 100;
}

// Deterministic external id: join with ':'; if the joined string would
// overflow findings.external_finding_id (VARCHAR(255)), keep it unique and
// stable by hashing the full value into the truncated tail.
function externalId(...parts) {
  const joined = parts.map((p) => String(p)).join(':');
  if (joined.length <= 255) return joined;
  const hash = crypto.createHash('sha256').update(joined).digest('hex').slice(0, 40);
  return `${joined.slice(0, 214)}~${hash}`;
}

function truncate(s, n) {
  if (s == null) return s;
  const str = String(s);
  return str.length <= n ? str : str.slice(0, n);
}

function metric(metric_type, value, unit) {
  return { metric_type, value, unit };
}

function finding(external_finding_id, title, severity, status) {
  return {
    external_finding_id,
    title: truncate(title, 512),
    severity: assertSeverity(severity),
    status: assertStatus(status),
  };
}

module.exports = {
  SEVERITIES,
  STATUSES,
  mapFrom,
  assertSeverity,
  assertStatus,
  num,
  pct,
  externalId,
  truncate,
  metric,
  finding,
};
