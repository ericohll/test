export function Field({ label, children, hint }) {
  return (
    <div className="qd-field">
      {label ? <label>{label}</label> : null}
      {children}
      {hint ? <span className="qd-table-caption">{hint}</span> : null}
    </div>
  );
}

export function TextInput(props) {
  return <input className="qd-input" type="text" {...props} />;
}

export function PasswordInput(props) {
  return <input className="qd-input" type="password" {...props} />;
}

export function NumberInput(props) {
  return <input className="qd-input" type="number" step="any" {...props} />;
}

export function Select({ options, ...props }) {
  return (
    <select className="qd-select" {...props}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function Button({ variant = 'primary', children, ...props }) {
  return (
    <button className={`qd-button qd-button-${variant}`} {...props}>
      {children}
    </button>
  );
}

export function ButtonRow({ children }) {
  return <div className="qd-button-row">{children}</div>;
}
