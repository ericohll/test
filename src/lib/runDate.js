function today() {
  return new Date().toISOString().slice(0, 10);
}

// Formats an ISO8601 timestamp as a MySQL DATETIME(3) literal
// ('YYYY-MM-DD HH:mm:ss.SSS'), in UTC, for columns like findings.seen_at.
// Deterministic per input, so replaying the same envelope's fetched_at
// through normalize always writes byte-identical timestamps.
function toMysqlDatetime(iso) {
  const d = new Date(iso);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
  );
}

// Normalises a run_date/target_date/evaluated_at value read back from the DB
// (or from fakeDb) into a plain 'YYYY-MM-DD' string for JSON responses.
// mysql2 returns DATE/DATETIME columns as JS Date objects; fakeDb stores
// whatever string a test seeded -- this makes both agree.
function toDateString(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

module.exports = { today, toMysqlDatetime, toDateString };
