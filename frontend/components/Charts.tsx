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
          <line key={i} x1="0" x2={w} y1={p + (i * (h - 2 * p)) / 3} y2={p + (i * (h - 2 * p)) / 3} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <polygon points={`${X(0)},${h - p} ${pts} ${X(last)},${h - p}`} fill="var(--accent)" opacity=".1" />
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {format &&
          v.map((x, i) => (
            <circle key={i} cx={X(i)} cy={Y(x)} r="10" fill="transparent">
              <title>{(xLabels?.[i] ? xLabels[i] + ": " : "") + format(x)}</title>
            </circle>
          ))}
        <circle cx={X(last)} cy={Y(v[last])} r="4.5" fill="var(--accent)" />
      </svg>
      {xLabels && xLabels.length > 1 && (
        <div className="row between tiny muted" style={{ marginTop: 6, fontVariantNumeric: "tabular-nums" }} aria-hidden="true">
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
