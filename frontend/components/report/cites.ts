// Inline citation helpers ("[3]", "[1, 4]", "[2-4]") shared by the on-screen
// renderer (remark plugin) and the export converter. No dependencies.
import type { Nodes, Parents, PhrasingContent, Root, Text } from "mdast";

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  href?: string;
  /** Citation number: `text` is "[n]". */
  cite?: number;
}

/** "[3]", "[1, 4]", "[2-4]", "[1; 3]" */
export const CITE_RE = /\[(\d{1,3}(?:\s*(?:[,;]|[-–])\s*\d{1,3})*)\]/g;

/** "1, 3-5" → [1, 3, 4, 5] (ranges capped so "[1-999]" can't explode). */
export function citeNumbers(group: string): number[] {
  const out: number[] = [];
  for (const part of group.split(/\s*[,;]\s*/)) {
    const range = /^(\d{1,3})\s*[-–]\s*(\d{1,3})$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b < a || b - a > 20) return [];
      for (let i = a; i <= b; i++) out.push(i);
    } else if (/^\d{1,3}$/.test(part)) out.push(Number(part));
    else return [];
  }
  return out;
}

/** Split plain text into text + citation inlines. */
export function splitCitations(text: string, base: Omit<Inline, "text">, isCite: (n: number) => boolean): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const re = new RegExp(CITE_RE.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const nums = citeNumbers(m[1]);
    if (!nums.length || !nums.every(isCite)) continue;
    if (m.index > last) out.push({ ...base, text: text.slice(last, m.index) });
    for (const n of nums) out.push({ ...base, text: `[${n}]`, cite: n });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ ...base, text: text.slice(last) });
  return out;
}

// ---------- remark plugin: "[n]" → <sup data-cite="n">n</sup> ----------

export type RemarkCitationsOptions = { valid: Set<number> };

function citeNode(n: number): Text {
  return { type: "text", value: String(n), data: { hName: "sup", hProperties: { dataCite: String(n) } } } as unknown as Text;
}

function transform(node: Parents, valid: Set<number>) {
  if (node.type === "link" || node.type === "linkReference") return; // never nest links
  let changed = false;
  const next: Nodes[] = [];
  for (const child of node.children as Nodes[]) {
    if (child.type === "text") {
      const parts = splitCitations(child.value, {}, (n) => valid.has(n));
      if (parts.length === 1 && parts[0].cite === undefined) {
        next.push(child);
        continue;
      }
      changed = true;
      for (const p of parts) next.push(p.cite !== undefined ? citeNode(p.cite) : ({ type: "text", value: p.text } as Text));
    } else if (child.type === "linkReference") {
      // "[3]" with a matching "[3]: url" definition parses as a reference link.
      const label = (child.children as PhrasingContent[]).map((c) => ("value" in c ? String(c.value) : "")).join("");
      if (/^\d{1,3}$/.test(label) && valid.has(Number(label))) {
        changed = true;
        next.push(citeNode(Number(label)));
      } else next.push(child);
    } else {
      if ("children" in child) transform(child as Parents, valid);
      next.push(child);
    }
  }
  if (changed) (node as { children: Nodes[] }).children = next;
}

/** Turns citations of known sources into `<sup data-cite>` elements for react-markdown. */
export function remarkCitations(options: RemarkCitationsOptions) {
  return (tree: Root) => {
    if (options?.valid?.size) transform(tree, options.valid);
  };
}

/** Read the citation number back from a hast `sup` node's properties. */
export function citeFromProps(properties: unknown): number | null {
  const raw = (properties as Record<string, unknown> | undefined)?.dataCite;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
