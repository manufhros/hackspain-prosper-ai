export function Bars({
  rows,
}: {
  rows: { label: string; value: number; note?: string }[];
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="bars">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="bars-meta">
            <span>{row.label}</span>
            <b>
              {row.value}
              {row.note ? <i> {row.note}</i> : null}
            </b>
          </div>
          <div className="bars-track">
            <div style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
