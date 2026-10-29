// "The trace" — Ensemblis's graphic motif. An objective becomes a sequence of steps; some steps gather
// numbered evidence; the line ends in a verified mark. Generated deterministically from a seed (an article
// slug, a page key), so each article has its own cover with no stock imagery, and the same seed always
// draws the same plate (pages, Open Graph images, RSS readers agree).
//
// It is abstract on purpose: it never pretends to be a product screenshot.

export const ACCENTS: Record<string, string> = {
  "ai-at-work": "#a9d6ff",
  strategy: "#f2b33d",
  "marketing-growth": "#ff8f6b",
  "ai-search": "#2b8cff",
  "sales-customers": "#3ccf91",
  operations: "#b9a4ff",
  default: "#2b8cff",
};

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic. */
function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TraceNode {
  x: number;
  y: number;
  evidence: number | null;
}

/** Node positions and evidence numbers for a seed, on a 1200 × 630 canvas. */
export function traceNodes(seed: string): TraceNode[] {
  const r = rng(seed);
  const n = 5 + Math.floor(r() * 3); // 5–7 steps, like a real plan (3–7)
  const left = 110;
  const right = 1090;
  let evidence = 0;
  return Array.from({ length: n }, (_, i) => {
    const x = Math.round(left + ((right - left) * i) / (n - 1));
    const y = i === 0 ? 315 : i === n - 1 ? 300 : Math.round(150 + r() * 330);
    const hasEvidence = i > 0 && i < n - 1 && r() > 0.35;
    return { x, y, evidence: hasEvidence ? ++evidence : null };
  });
}

/** An orthogonal "circuit" path through the nodes (horizontal, vertical, horizontal). */
export function tracePath(nodes: TraceNode[]): string {
  return nodes
    .map((p, i) => {
      if (i === 0) return `M${p.x} ${p.y}`;
      const prev = nodes[i - 1];
      const mid = Math.round((prev.x + p.x) / 2);
      return `H${mid} V${p.y} H${p.x}`;
    })
    .join(" ");
}

/**
 * The plate as a standalone SVG string (1200 × 630). Decorative: callers mark it aria-hidden.
 * `variant: "plate"` draws the dark background; "line" draws only the trace (for use over a page's own background).
 */
export function traceSvg(seed: string, accent = ACCENTS.default, variant: "plate" | "line" = "plate", opts: { labels?: boolean } = {}): string {
  const labels = opts.labels ?? true;
  const nodes = traceNodes(seed);
  const d = tracePath(nodes);
  const r = rng(`${seed}:ghost`);
  const ghost = (dy: number) =>
    tracePath(nodes.map((p, i) => ({ ...p, y: i === 0 || i === nodes.length - 1 ? p.y + dy : Math.round(Math.min(560, Math.max(70, p.y + dy + (r() - 0.5) * 120))) })));
  const last = nodes[nodes.length - 1];
  const id = `t${hash(seed).toString(36)}`;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" preserveAspectRatio="xMidYMid slice" focusable="false">`);
  if (variant === "plate") {
    parts.push(
      `<defs><pattern id="${id}g" width="30" height="30" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.3" fill="#8fa0b4" fill-opacity="0.16"/></pattern>` +
        `<radialGradient id="${id}r" cx="78%" cy="45%" r="60%"><stop offset="0" stop-color="${accent}" stop-opacity="0.20"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs>` +
        `<rect width="1200" height="630" fill="#07111f"/><rect width="1200" height="630" fill="url(#${id}g)"/><rect width="1200" height="630" fill="url(#${id}r)"/>`
    );
  }
  parts.push(`<path d="${ghost(-46)}" fill="none" stroke="#8fa0b4" stroke-opacity="0.18" stroke-width="2"/>`);
  parts.push(`<path d="${ghost(52)}" fill="none" stroke="#8fa0b4" stroke-opacity="0.12" stroke-width="2"/>`);
  parts.push(`<path d="${d}" fill="none" stroke="${accent}" stroke-width="4" stroke-linejoin="round"/>`);
  nodes.forEach((p, i) => {
    if (i === nodes.length - 1) return;
    parts.push(`<circle cx="${p.x}" cy="${p.y}" r="${i === 0 ? 11 : 8}" fill="#07111f" stroke="${accent}" stroke-width="4"/>`);
    if (labels && p.evidence !== null) {
      const above = p.y > 160;
      const ly = above ? p.y - 44 : p.y + 22;
      parts.push(
        `<rect x="${p.x - 26}" y="${ly}" width="52" height="26" rx="5" fill="#0b1730" stroke="${accent}" stroke-opacity="0.55" stroke-width="1.5"/>` +
          `<text x="${p.x}" y="${ly + 18}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" font-weight="600" fill="${accent}">[${p.evidence}]</text>`
      );
    }
  });
  // The verified end: a ring and a check.
  parts.push(
    `<circle cx="${last.x}" cy="${last.y}" r="26" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="2"/>` +
      `<circle cx="${last.x}" cy="${last.y}" r="17" fill="${accent}"/>` +
      `<path d="M${last.x - 7} ${last.y} l5 5 l9 -10" fill="none" stroke="#07111f" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`
  );
  parts.push(`</svg>`);
  return parts.join("");
}

/** For raster images (Open Graph): no text labels — the image renderer has no fonts for SVG text. */
export const traceDataUri = (seed: string, accent?: string) => `data:image/svg+xml;base64,${Buffer.from(traceSvg(seed, accent, "plate", { labels: false })).toString("base64")}`;
