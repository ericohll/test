// Pure display-formatting helpers shared by pages.

export function formatNumber(value) {
  if (value === undefined || value === null || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString();
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function titleCase(value) {
  if (!value) return '';
  return String(value)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// thresholds.operator enum (db/migrations/001_init.sql): lt|lte|gt|gte|eq
// src/lib/operators.js's passes(value, operator, threshold) expresses the
// PASS condition for that operator, so the UI must label it that way.
const OPERATOR_LABELS = {
  lt: 'lt — passes when value < threshold',
  lte: 'lte — passes when value ≤ threshold',
  gt: 'gt — passes when value > threshold',
  gte: 'gte — passes when value ≥ threshold',
  eq: 'eq — passes when value = threshold',
};

export function prettyOperator(operator) {
  return OPERATOR_LABELS[operator] || operator || '—';
}
