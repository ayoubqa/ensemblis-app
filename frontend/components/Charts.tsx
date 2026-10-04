// SVG charts ported from the prototype's lineChart / perfGraphSVG.
// Pure render (no hooks) — usable from server or client components.

export interface LineChartProps {
  values: number[];
  /** viewBox height (width is 600; the SVG scales to its container). Default 180. */
  height?: number;
  /** Baseline value. Default 0 (prototype). */
  min?: number;
  /** Accessible label. */
  label?: string;
  /** Optional x labels rendered under the chart (first / middle / last are shown). */
  xLabels?: string[];
  /** Value formatter for <title> tooltips on points. */
  format?: (v: number) => string;
}

/** Area + line chart with 4 gridlines and an end dot (prototype `lineChart`). */
export function LineChart({ values, height = 180, min = 0, label = "Chart", xLabels, format }: LineChartProps) {
  const v = values.length === 1 ? [values[0], values[0]] : values.length ? values : [0, 0];
  const w = 600;
  const h = height;
  const p = 8;
  let mx = Math.max(...v) * 1.08;
  if (mx <= min) mx = min + 1;
  const X = (i: number) => p + (i * (w - 2 * p)) / (v.length - 1);
  const Y = (x: number) => h - p - ((x - min) / (mx - min)) * (h - 2 * p);
  const pts = v.map((x, i) => `${X(i)},${Y(x)}`).join(" ");
  const last = v.length - 1;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={label}>
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1="0" x2={w} y1={p + (i * (h - 2 * p)) / 3} y2={p + (i * (h - 2 * p)) / 3} stroke="var(--line)" strokeWidth="1" />
        ))}
        <polygon points={`${X(0)},${h - p} ${pts} ${X(last)},${h - p}`} fill="var(--accent)" opacity=".09" />
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {format &&
          v.map((x, i) => (
            <circle key={i} cx={X(i)} cy={Y(x)} r="10" fill="transparent">
              <title>{(xLabels?.[i] ? xLabels[i] + ": " : "") + format(x)}</title>
            </circle>
          ))}
        <circle cx={X(last)} cy={Y(v[last])} r="4.5" fill="var(--accent)" />
      </svg>
      {xLabels && xLabels.length > 1 && (
        <div className="row between tiny muted" style={{ marginTop: 6 }}>
          <span>{xLabels[0]}</span>
          {xLabels.length > 2 && <span>{xLabels[Math.floor((xLabels.length - 1) / 2)]}</span>}
          <span>{xLabels[xLabels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}

/** Tiny inline trend line (no grid). */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  label = "Trend",
  color = "var(--accent)",
}: {
  values: number[];
  width?: number;
  height?: number;
  label?: string;
  color?: string;
}) {
  const v = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const mn = Math.min(...v);
  const mx = Math.max(...v);
  const span = mx - mn || 1;
  const p = 3;
  const X = (i: number) => p + (i * (width - 2 * p)) / (v.length - 1);
  const Y = (x: number) => height - p - ((x - mn) / span) * (height - 2 * p);
  const pts = v.map((x, i) => `${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polygon points={`${X(0)},${height} ${pts} ${X(v.length - 1)},${height}`} fill={color} opacity=".1" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(v.length - 1)} cy={Y(v[v.length - 1])} r="2.5" fill={color} />
    </svg>
  );
}

export type PerfRow = [left: string, right: string, pct: number];

/**
 * The Agent Performance Graph (prototype `perfGraphSVG`): task types on the left,
 * agents on the right, curves weighted by success %.
 */
export function PerfGraph({ rows, leftLabel = "Task type", rightLabel = "Agent" }: { rows: PerfRow[]; leftLabel?: string; rightLabel?: string }) {
  const w = 640;
  const hgt = Math.max(170, rows.length * 52 + 30);
  const lx = 10;
  const rx = w - 172;
  const ys = rows.map((_, i) => 30 + i * ((hgt - 54) / Math.max(1, rows.length - 1 || 1)));
  const rightNames = Array.from(new Set(rows.map((r) => r[1])));
  const ry = rightNames.map((_, i) => 30 + i * ((hgt - 54) / Math.max(1, rightNames.length - 1 || 1)));
  const c1x = lx + (rx - lx) * 0.42;
  const c2x = lx + (rx - lx) * 0.58;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`-28 0 ${w + 28} ${hgt}`}
        style={{ width: "100%", minWidth: 460, height: "auto", display: "block", fontFamily: "var(--sans)" }}
        role="img"
        aria-label={`Diagram of how ${leftLabel.toLowerCase()}s route to ${rightLabel.toLowerCase()}s, weighted by success rate`}
      >
        <text x={lx} y="12" fontSize="10" fill="var(--muted)" letterSpacing="1">
          {leftLabel.toUpperCase()}
        </text>
        <text x={rx - 8} y="12" fontSize="10" fill="var(--muted)" letterSpacing="1" textAnchor="middle">
          {rightLabel.toUpperCase()}
        </text>
        {rows.map((r, i) => {
          const ri = rightNames.indexOf(r[1]);
          const y0 = ys[i];
          const y1 = ry[ri];
          const pct = r[2];
          return (
            <path
              key={`e${i}`}
              d={`M${lx + 134},${y0} C${c1x},${y0} ${c2x},${y1} ${rx - 8},${y1}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={(1 + (pct / 100) * 3.4).toFixed(1)}
              opacity={(0.22 + (pct / 100) * 0.55).toFixed(2)}
            >
              <title>{`${r[0]} → ${r[1]}: ${pct}% success`}</title>
            </path>
          );
        })}
        {rows.map((r, i) => (
          <g key={`l${i}`}>
            <title>{r[0]}</title>
            <circle cx={lx + 134} cy={ys[i]} r="4" fill="var(--ink)" />
            <text x={lx + 122} y={ys[i] + 4} fontSize="12" fill="var(--ink)" textAnchor="end" fontWeight="600">
              {r[0]}
            </text>
          </g>
        ))}
        {rightNames.map((n, i) => {
          const m = rows.filter((r) => r[1] === n);
          const avg = Math.round(m.reduce((s, r) => s + r[2], 0) / m.length);
          return (
            <g key={`r${i}`}>
              <title>{`${n}: ${avg}% avg success`}</title>
              <circle cx={rx - 8} cy={ry[i]} r="5" fill="var(--accent)" />
              <text x={rx + 6} y={ry[i] + 4} fontSize="12" fill="var(--ink)" fontWeight="600">
                {n}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Horizontal bar row (`.hbar`) — label · bar · value. */
export function HBar({ label, value, max = 100, display, labelWidth }: { label: string; value: number; max?: number; display?: string; labelWidth?: number }) {
  const pctW = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="hbar" style={labelWidth ? { gridTemplateColumns: `${labelWidth}px 1fr 64px` } : undefined}>
      <span className="muted">{label}</span>
      <div className="b" role="presentation">
        <i style={{ width: `${pctW}%` }} />
      </div>
      <b>{display ?? value}</b>
    </div>
  );
}
