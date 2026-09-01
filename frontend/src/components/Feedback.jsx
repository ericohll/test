export function Banner({ variant = 'info', children, onRetry, retryLabel = 'Retry' }) {
  return (
    <div className={`qd-banner qd-banner-${variant}`}>
      <span>{children}</span>
      {onRetry ? (
        <button className="qd-button-link" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function Spinner({ fullPage = false }) {
  if (fullPage) {
    return (
      <div className="qd-full-page-spinner">
        <div className="qd-spinner" />
      </div>
    );
  }
  return (
    <div className="qd-spinner-wrap">
      <div className="qd-spinner" />
    </div>
  );
}

export function EmptyState({ children }) {
  return <div className="qd-empty-state">{children}</div>;
}

// Collapsible raw JSON viewer, rendered only in dev builds by callers.
export function RawJson({ label = 'Raw response', data }) {
  return (
    <details className="qd-raw-json">
      <summary>{label}</summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
