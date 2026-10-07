import type { DayCount } from "@/lib/api";
import { num } from "@/lib/format";
import { dayLabelUTC } from "./adminFormat";

/**
 * Stacked daily bars: completed (status ok) at the base, failed (status bad) on
 * top, separated by a 2px surface gap. One y-scale, hairline grid, native
 * hover titles, a legend with totals and a screen-reader table.
 */
export function DailyBars({ completed, failed, height = 150, label = "Executions per day" }: { completed: DayCount[]; failed: DayCount[]; height?: number; label?: string }) {
  const days = Array.from(new Set([...completed.map((d) => d.day), ...failed.map((d) => d.day)])).sort();
  const okBy = new Map(completed.map((d) => [d.day, d.count]));
  const badBy = new Map(failed.map((d) => [d.day, d.count]));
  const rows = days.map((day) => ({ day, ok: okBy.get(day) ?? 0, bad: badBy.get(day) ?? 0 }));
  const max = Math.max(1, ...rows.map((r) => r.ok + r.bad)) * 1.08;
  const totalOk = rows.reduce((n, r) => n + r.ok, 0);
  const totalBad = rows.reduce((n, r) => n + r.bad, 0);

  const w = 600;
  const h = height;
  const p = 8;
  const n = Math.max(1, rows.length);
  const slot = w / n;
  const barW = Math.max(4, Math.min(26, slot * 0.6));
  const scale = (v: number) => (v / max) * (h - 2 * p);
  const labels = rows.map((r) => dayLabelUTC(r.day));

  return (
    <div>
      <div className="row wrapflex tiny" style={{ gap: 14, marginBottom: 8 }} aria-hidden="true">
        <span className="row" style={{ gap: 6 }}>
          <i style={{ width: 10, height: 10, borderRadius: 3, background: "var(--ok)", display: "inline-block" }} />
          Completed <b>{num(totalOk)}</b>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <i style={{ width: 10, height: 10, borderRadius: 3, background: "var(--bad)", display: "inline-block" }} />
          Failed <b>{num(totalBad)}</b>
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`${label}: ${num(totalOk)} completed and ${num(totalBad)} failed over ${rows.length} days`}>
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1="0" x2={w} y1={p + (i * (h - 2 * p)) / 3} y2={p + (i * (h - 2 * p)) / 3} stroke="var(--line)" strokeWidth="1" />
        ))}
        {rows.map((r, i) => {
          const x = i * slot + (slot - barW) / 2;
          const okH = scale(r.ok);
          const badH = scale(r.bad);
          const base = h - p;
          const gap = r.ok > 0 && r.bad > 0 ? 2 : 0;
          return (
            <g key={r.day}>
              <title>{`${labels[i]}: ${num(r.ok)} completed, ${num(r.bad)} failed`}</title>
              <rect x={i * slot} y={0} width={slot} height={h} fill="transparent" />
              {r.ok > 0 && <rect x={x} y={base - okH} width={barW} height={Math.max(2, okH)} rx={3} fill="var(--ok)" />}
              {r.bad > 0 && <rect x={x} y={base - okH - gap - Math.max(2, badH)} width={barW} height={Math.max(2, badH)} rx={3} fill="var(--bad)" />}
            </g>
          );
        })}
        <line x1="0" x2={w} y1={h - p} y2={h - p} stroke="var(--line2)" strokeWidth="1" />
      </svg>
      {labels.length > 1 && (
        <div className="row between tiny muted" style={{ marginTop: 6 }} aria-hidden="true">
          <span>{labels[0]}</span>
          {labels.length > 2 && <span>{labels[Math.floor((labels.length - 1) / 2)]}</span>}
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
      {/* sr-only on a wrapper: a <table> ignores the 1px width (and gets the global min-width), which overflowed phones */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Completed</th>
              <th scope="col">Failed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.day}>
                <th scope="row">{labels[i]}</th>
                <td>{r.ok}</td>
                <td>{r.bad}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
