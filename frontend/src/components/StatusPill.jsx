// gate_results.status enum (db/migrations/001_init.sql): pass | fail | unknown
const LABELS = {
  pass: 'Pass',
  fail: 'Fail',
  unknown: 'Unknown',
};

export default function StatusPill({ status }) {
  const key = LABELS[status] ? status : 'unknown';
  return <span className={`qd-pill qd-pill-${key}`}>{LABELS[key]}</span>;
}
