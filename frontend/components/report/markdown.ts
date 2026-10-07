// Markdown → simple document blocks, shared by the PDF and Word exporters.
//
// Parsing uses the same engine react-markdown uses on screen (unified +
// remark-parse + remark-gfm, already installed as react-markdown's
// dependencies), so tables, nested lists and inline marks come out exactly
// as they render. Inline citations like "[3]" or "[1, 4]" become `cite`
// inlines so exporters can style/link them while keeping the "[n]" text.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Nodes, Parents, PhrasingContent, Root, RootContent, Table } from "mdast";
import { splitCitations, type Inline } from "./cites";

export type { Inline } from "./cites";
export { CITE_RE, citeNumbers, splitCitations } from "./cites";

export type Align = "left" | "right" | "center" | null;

export interface ListItemBlock {
  checked: boolean | null;
  blocks: Block[];
}

export type Block =
  | { type: "heading"; depth: number; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItemBlock[] }
  | { type: "table"; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  | { type: "code"; text: string; lang: string | null }
  | { type: "quote"; blocks: Block[] }
  | { type: "hr" };

export interface ParseOptions {
  /** Which citation numbers are real sources. Default: any number 1–999. */
  isCite?: (n: number) => boolean;
}

const parser = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdownTree(md: string): Root {
  return parser.parse(md.replace(/\r\n?/g, "\n")) as Root;
}

type Marks = Omit<Inline, "text" | "cite">;

/** Markdown → blocks. Never throws: falls back to one paragraph per line. */
export function markdownToBlocks(md: string, opts: ParseOptions = {}): Block[] {
  const isCite = opts.isCite ?? ((n: number) => n >= 1 && n <= 999);
  try {
    const tree = parseMarkdownTree(md);
    const defs = new Map<string, string>();
    collectDefinitions(tree, defs);
    return convertBlocks(tree.children, { isCite, defs });
  } catch {
    return md
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => ({ type: "paragraph" as const, inlines: [{ text: p }] }));
  }
}

interface Ctx {
  isCite: (n: number) => boolean;
  defs: Map<string, string>;
}

function collectDefinitions(node: Nodes, defs: Map<string, string>) {
  if (node.type === "definition") defs.set(node.identifier.toLowerCase(), node.url);
  if ("children" in node) for (const c of (node as Parents).children) collectDefinitions(c as Nodes, defs);
}

function convertBlocks(nodes: RootContent[], ctx: Ctx): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        out.push({ type: "heading", depth: node.depth, inlines: tidy(inlines(node.children, {}, ctx)) });
        break;
      case "paragraph": {
        const ins = tidy(inlines(node.children, {}, ctx));
        if (ins.length) out.push({ type: "paragraph", inlines: ins });
        break;
      }
      case "list":
        out.push({
          type: "list",
          ordered: !!node.ordered,
          start: typeof node.start === "number" ? node.start : 1,
          items: node.children.map((li) => ({
            checked: typeof li.checked === "boolean" ? li.checked : null,
            blocks: convertBlocks(li.children, ctx),
          })),
        });
        break;
      case "table":
        out.push(convertTable(node, ctx));
        break;
      case "code":
        out.push({ type: "code", text: node.value, lang: node.lang ?? null });
        break;
      case "blockquote":
        out.push({ type: "quote", blocks: convertBlocks(node.children, ctx) });
        break;
      case "thematicBreak":
        out.push({ type: "hr" });
        break;
      case "html": {
        const text = stripHtml(node.value);
        if (text) out.push({ type: "paragraph", inlines: [{ text }] });
        break;
      }
      case "definition":
      case "footnoteDefinition":
      case "yaml" as string:
        break;
      default:
        // Unknown block (e.g. math): keep its text so nothing silently disappears.
        if ("children" in node) {
          const ins = tidy(inlines((node as Parents).children as PhrasingContent[], {}, ctx));
          if (ins.length) out.push({ type: "paragraph", inlines: ins });
        } else if ("value" in node && typeof (node as { value?: unknown }).value === "string") {
          out.push({ type: "paragraph", inlines: [{ text: (node as { value: string }).value }] });
        }
    }
  }
  return out;
}

function convertTable(node: Table, ctx: Ctx): Block {
  const rows = node.children.map((row) => row.children.map((cell) => tidy(inlines(cell.children, {}, ctx))));
  const width = Math.max(1, ...rows.map((r) => r.length));
  const pad = (r: Inline[][]) => (r.length < width ? [...r, ...Array.from({ length: width - r.length }, () => [] as Inline[])] : r.slice(0, width));
  const align: Align[] = Array.from({ length: width }, (_, i) => (node.align?.[i] as Align) ?? null);
  return { type: "table", align, header: pad(rows[0] ?? []), rows: rows.slice(1).map(pad) };
}

function inlines(nodes: PhrasingContent[], marks: Marks, ctx: Ctx): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        if (marks.href) out.push({ ...marks, text: node.value });
        else out.push(...splitCitations(node.value, marks, ctx.isCite));
        break;
      case "strong":
        out.push(...inlines(node.children, { ...marks, bold: true }, ctx));
        break;
      case "emphasis":
        out.push(...inlines(node.children, { ...marks, italic: true }, ctx));
        break;
      case "delete":
        out.push(...inlines(node.children, { ...marks, strike: true }, ctx));
        break;
      case "inlineCode":
        out.push({ ...marks, code: true, text: node.value });
        break;
      case "break":
        out.push({ ...marks, text: "\n" });
        break;
      case "link": {
        const safe = safeUrl(node.url);
        out.push(...inlines(node.children, safe ? { ...marks, href: safe } : marks, ctx));
        break;
      }
      case "linkReference": {
        const label = toText(node.children);
        const n = /^\d{1,3}$/.test(label) ? Number(label) : NaN;
        if (!marks.href && Number.isFinite(n) && ctx.isCite(n)) {
          out.push({ ...marks, text: `[${n}]`, cite: n });
          break;
        }
        const url = safeUrl(ctx.defs.get(node.identifier.toLowerCase()) ?? "");
        out.push(...inlines(node.children, url ? { ...marks, href: url } : marks, ctx));
        break;
      }
      case "footnoteReference": {
        const n = /^\d{1,3}$/.test(node.identifier) ? Number(node.identifier) : NaN;
        if (Number.isFinite(n) && ctx.isCite(n)) out.push({ ...marks, text: `[${n}]`, cite: n });
        else out.push({ ...marks, text: `[${node.label ?? node.identifier}]` });
        break;
      }
      case "image":
      case "imageReference":
        if (node.alt) out.push({ ...marks, text: node.alt });
        break;
      case "html": {
        const t = stripHtml(node.value);
        if (/^<br\s*\/?>$/i.test(node.value.trim())) out.push({ ...marks, text: "\n" });
        else if (t) out.push({ ...marks, text: t });
        break;
      }
      default:
        if ("children" in node) out.push(...inlines((node as Parents).children as PhrasingContent[], marks, ctx));
        else if ("value" in node && typeof (node as { value?: unknown }).value === "string") out.push({ ...marks, text: (node as { value: string }).value });
    }
  }
  return out;
}

/** Merge neighbours with identical marks; drop empty runs. */
function tidy(list: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const it of list) {
    if (!it.text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.cite === undefined && it.cite === undefined && sameMarks(prev, it)) prev.text += it.text;
    else out.push({ ...it });
  }
  return out;
}

function sameMarks(a: Inline, b: Inline) {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.code === !!b.code && !!a.strike === !!b.strike && a.href === b.href;
}

function toText(nodes: PhrasingContent[]): string {
  return nodes.map((n) => ("value" in n ? String(n.value) : "children" in n ? toText(n.children as PhrasingContent[]) : "")).join("");
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Only http(s) and mailto links are kept in exported documents. */
export function safeUrl(url: string): string | undefined {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : undefined;
}

// ---------- Plain-text helpers ----------

export function inlinesToText(list: Inline[]): string {
  return list.map((i) => i.text).join("");
}

/** The report's own `# Title`, if the markdown opens with one. */
export function leadingTitle(blocks: Block[]): string | null {
  const first = blocks[0];
  return first && first.type === "heading" && first.depth === 1 ? inlinesToText(first.inlines).trim() || null : null;
}

/** Drop a leading `# Title` (the exporters print their own title). */
export function withoutLeadingTitle(blocks: Block[]): Block[] {
  return leadingTitle(blocks) !== null ? blocks.slice(1) : blocks;
}
