// Generic table primitive. `columns` is [{ key, header, render(row) }].
export default function DataTable({ columns, rows, onRowClick, emptyMessage = 'No data to show.' }) {
  if (!rows || rows.length === 0) {
    return <div className="qd-empty-state">{emptyMessage}</div>;
  }

  return (
    <div className="qd-table-wrap">
      <table className="qd-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.__key ?? idx}
              className={onRowClick ? 'qd-row-clickable' : ''}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
