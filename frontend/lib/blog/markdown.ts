// Markdown helpers shared by the article renderer and the content checks. Articles are GitHub-flavoured
// Markdown (tables, footnotes, task lists). Two small remark plugins run in BOTH places, so the table of
// contents and the rendered page always agree on heading anchors:
//   remarkHeadingIds  — stable, de-duplicated ids on h2–h4 ("## What is GEO?" → #what-is-geo)
//   remarkCallouts    — "> [!DEFINITION]" style blockquotes become labelled <aside> boxes
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

// Minimal mdast shapes (enough for what these helpers touch).
interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  alt?: string | null;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

export const CALLOUTS = {
  DEFINITION: "Definition",
  KEY: "Key point",
  NOTE: "Note",
  CAUTION: "Caution",
  EXAMPLE: "Example",
  METHOD: "Method",
} as const;
export type CalloutType = keyof typeof CALLOUTS;

export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[’'"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "section"
  );
}

export function textOf(node: MdNode): string {
  if (typeof node.value === "string" && (node.type === "text" || node.type === "inlineCode")) return node.value;
  return (node.children ?? []).map(textOf).join("");
}

function walk(node: MdNode, visit: (n: MdNode, parent: MdNode | null) => void, parent: MdNode | null = null) {
  visit(node, parent);
  for (const c of node.children ?? []) walk(c, visit, node);
}

/** Adds ids to h2–h4, de-duplicating repeats ("faq", "faq-2"). */
export function remarkHeadingIds() {
  return (tree: MdNode) => {
    const seen = new Map<string, number>();
    walk(tree, (n) => {
      if (n.type !== "heading" || !n.depth || n.depth < 2 || n.depth > 4) return;
      const base = slugify(textOf(n));
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count ? `${base}-${count + 1}` : base;
      n.data = { ...(n.data ?? {}), hProperties: { ...(n.data?.hProperties ?? {}), id } };
    });
  };
}

/** "> [!KEY]\n> text" → <aside class="callout" data-callout="key" data-label="Key point">text</aside> */
export function remarkCallouts() {
  return (tree: MdNode) => {
    walk(tree, (n) => {
      if (n.type !== "blockquote") return;
      const first = n.children?.[0];
      const lead = first?.type === "paragraph" ? first.children?.[0] : undefined;
      if (!lead || lead.type !== "text" || typeof lead.value !== "string") return;
      const m = /^\[!([A-Z]+)\][ \t]*(?:\r?\n)?/.exec(lead.value);
      if (!m || !(m[1] in CALLOUTS)) return;
      const type = m[1] as CalloutType;
      lead.value = lead.value.slice(m[0].length);
      if (!lead.value && first?.children) first.children.shift();
      // "> [!METHOD]" alone on its line, followed by a list: drop the now-empty paragraph.
      if (first && !first.children?.length) n.children?.shift();
      n.data = { ...(n.data ?? {}), hName: "aside", hProperties: { className: ["callout"], "data-callout": type.toLowerCase(), "data-label": CALLOUTS[type] } };
    });
  };
}

export const REMARK_PLUGINS = [remarkGfm, remarkHeadingIds, remarkCallouts];

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface MarkdownAnalysis {
  headings: Heading[];
  /** h1 headings in the body (the title is the page's only h1). */
  h1Count: number;
  images: { url: string; alt: string }[];
  links: string[];
  words: number;
  footnotes: number;
  callouts: number;
}

export function analyzeMarkdown(body: string): MarkdownAnalysis {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkHeadingIds).use(remarkCallouts);
  const tree = processor.runSync(processor.parse(body)) as unknown as MdNode;
  const out: MarkdownAnalysis = { headings: [], h1Count: 0, images: [], links: [], words: 0, footnotes: 0, callouts: 0 };
  walk(tree, (n, parent) => {
    if (n.type === "heading") {
      if (n.depth === 1) out.h1Count++;
      const id = n.data?.hProperties?.id;
      if (typeof id === "string" && n.depth) out.headings.push({ depth: n.depth, text: textOf(n), id });
    } else if (n.type === "image") {
      out.images.push({ url: n.url ?? "", alt: (n.alt ?? "").trim() });
    } else if (n.type === "link" || n.type === "definition") {
      if (n.url) out.links.push(n.url);
    } else if (n.type === "footnoteDefinition") {
      out.footnotes++;
    } else if (n.type === "blockquote" && n.data?.hName === "aside") {
      out.callouts++;
    } else if (n.type === "text" && parent?.type !== "code") {
      out.words += (n.value ?? "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    }
  });
  return out;
}

/** ~230 words a minute, never "0 min". */
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 230));
