export function Card({ children, className = '' }) {
  return <div className={`qd-card ${className}`.trim()}>{children}</div>;
}

export function CardHeader({ title, right = null }) {
  return (
    <div className="qd-card-header">
      <h3 className="qd-card-title">{title}</h3>
      {right}
    </div>
  );
}
