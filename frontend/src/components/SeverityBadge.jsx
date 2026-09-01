// findings.severity enum (db/migrations/001_init.sql): critical|high|medium|low|info
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export default function SeverityBadge({ severity, count }) {
  const key = SEVERITIES.includes(severity) ? severity : 'info';
  return (
    <span className={`qd-badge qd-badge-${key}`}>
      {key}
      {count != null ? ` (${count})` : ''}
    </span>
  );
}

// Stacked proportional bar. This is the one component allowed an inline
// style attribute (proportional width percentages cannot be expressed as a
// fixed CSS class ahead of time).
export function SeverityBar({ counts }) {
  const total = SEVERITIES.reduce((sum, sev) => sum + (counts[sev] || 0), 0);
  if (!total) {
    return <div className="qd-severity-bar" />;
  }
  return (
    <div className="qd-severity-bar">
      {SEVERITIES.map((sev) => {
        const value = counts[sev] || 0;
        if (!value) return null;
        const pct = (value / total) * 100;
        return (
          <div
            key={sev}
            className={`qd-severity-bar-segment qd-sev-${sev}`}
            style={{ width: `${pct}%` }}
            title={`${sev}: ${value}`}
          />
        );
      })}
    </div>
  );
}
