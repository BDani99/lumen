export function CostMiniTable({
  title,
  rows,
}: {
  title?: string;
  rows: { label: string; value: string; active?: boolean }[];
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-[var(--radius)] border border-border">
      {title && (
        <div className="border-b border-border bg-bg-elevated px-3 py-1.5 text-[11px] font-medium text-muted">
          {title}
        </div>
      )}
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              className={
                r.active
                  ? "bg-accent-muted"
                  : "odd:bg-transparent even:bg-bg-elevated/50"
              }
            >
              <td className="px-3 py-1.5 text-muted">{r.label}</td>
              <td className="px-3 py-1.5 text-right font-mono text-ink">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
