export default function MetricTile({ label, value, unit, caption }) {
  const display = value === undefined || value === null || value === '' ? '—' : value;
  return (
    <div className="qd-metric-tile">
      <div className="qd-metric-label">{label}</div>
      <div className="qd-metric-value">
        {display}
        {unit && display !== '—' ? <span className="qd-metric-unit">{unit}</span> : null}
      </div>
      {caption ? <div className="qd-metric-caption">{caption}</div> : null}
    </div>
  );
}
