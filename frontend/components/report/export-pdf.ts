// PDF export. Loaded lazily by <ExportMenu> (dynamic import on click), and it
// in turn lazy-loads pdfmake + its bundled Roboto fonts.
import { leadingTitle, markdownToBlocks, withoutLeadingTitle, type Block, type Inline } from "./markdown";
import { AI_NOTE, KIND_LABEL, metaLine, prettyDate, safeHref, sortSources, sourceDomain, type ExportInput } from "./shared";

type Node = Record<string, unknown>;
type Content = Node | string | Content[];

const ACCENT = "#5B3DF5";
const INK = "#0B1020";
const MUTED = "#586178";
const LINE = "#E2E5EE";
const SOFT = "#F5F6FA";
const CODE_BG = "#EEF0F6";
const PAGE_W = 595.28; // A4
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

/** Roboto (pdfmake's bundled font) lacks arrows, check marks and emoji: map or drop them. */
const GLYPHS: [RegExp, string][] = [
  [/[→⇒➡➔➜]️?/g, "->"],
  [/[←⇐⬅]️?/g, "<-"],
  [/[↔⇔]/g, "<->"],
  [/[↑▲⬆]️?/g, "up"],
  [/[↓▼⬇]️?/g, "down"],
  [/[✓✔✅☑]️?/g, "Yes"],
  [/[✗✘❌❎☒]️?/g, "No"],
  [/⚠️?/g, "(!)"],
  [/[★☆⭐]️?/g, "*"],
  [/[►▸▶◆◇□]️?/g, "-"],
  [/※/g, "*"],
  // Emoji, pictographs, dingbats, variation selectors, zero-width joiners.
  [/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}‍]/gu, ""],
];

export function pdfSafe(s: string): string {
  let out = s;
  for (const [re, rep] of GLYPHS) out = out.replace(re, rep);
  return out;
}

export interface PdfOptions {
  /** Footer text on the left; defaults to "Ensemblis · <title>". */
  footerLabel?: string;
}

/** Build the pdfmake document definition (pure; unit-testable in Node). */
export function buildPdfDefinition(input: ExportInput, opts: PdfOptions = {}): Node {
  const sources = sortSources(input.sources);
  const valid = new Set(sources.map((s) => s.n));
  const parsed = markdownToBlocks(input.markdown || "", { isCite: (n) => valid.has(n) });
  const title = pdfSafe((input.title || leadingTitle(parsed) || "Report").trim());
  const blocks = withoutLeadingTitle(parsed);

  const runs = (list: Inline[], base: Node = {}): Node[] | string =>
    !list.length
      ? ""
      : list.map((i) => {
      const r: Node = { ...base, text: pdfSafe(i.text) };
      if (i.bold) r.bold = true;
      if (i.italic) r.italics = true;
      if (i.strike) r.decoration = "lineThrough";
      if (i.code) {
        r.background = CODE_BG;
        r.fontSize = 9.5;
      }
      if (i.href) {
        r.link = i.href;
        r.color = ACCENT;
        r.decoration = "underline";
      }
      if (i.cite !== undefined) {
        r.color = ACCENT;
        r.fontSize = 8.5;
        r.bold = true;
        if (valid.has(i.cite)) r.linkToDestination = `src-${i.cite}`;
      }
      return r;
    });

  const block = (b: Block, inList = false): Content | null => {
    switch (b.type) {
      case "heading": {
        const size = [0, 18, 15, 12.5, 11, 10.5, 10.5][b.depth] ?? 10.5;
        return {
          text: runs(b.inlines),
          fontSize: size,
          bold: true,
          color: INK,
          lineHeight: 1.15,
          margin: [0, b.depth <= 2 ? 16 : 10, 0, 6],
          headlineLevel: 1,
        };
      }
      case "paragraph":
        return { text: runs(b.inlines), margin: inList ? [0, 1, 0, 3] : [0, 0, 0, 8] };
      case "list": {
        const items = b.items.map((item) => {
          const parts = item.blocks.map((x) => block(x, true)).filter((x): x is Content => x !== null);
          if (item.checked !== null) parts.unshift({ text: item.checked ? "[x]" : "[ ]", color: MUTED, fontSize: 9 });
          if (!parts.length) return "";
          return parts.length === 1 ? parts[0] : { stack: parts };
        });
        const node: Node = { [b.ordered ? "ol" : "ul"]: items, margin: inList ? [0, 2, 0, 2] : [0, 0, 0, 8], markerColor: ACCENT };
        if (b.ordered && b.start !== 1) node.start = b.start;
        return node;
      }
      case "table": {
        const all = [b.header, ...b.rows];
        const widths = b.header.map((_, c) => {
          const longest = Math.max(...all.map((r) => (r[c] ?? []).map((i) => i.text).join("").length));
          return longest <= 14 ? "auto" : "*";
        });
        const align = (c: number) => (b.align[c] === "right" ? "right" : b.align[c] === "center" ? "center" : "left");
        const body = [
          b.header.map((cell, c) => ({ text: runs(cell), bold: true, fillColor: SOFT, fontSize: 9, color: INK, alignment: align(c) })),
          ...b.rows.map((row) => row.map((cell, c) => ({ text: runs(cell), fontSize: 9, alignment: align(c) }))),
        ];
        return {
          table: { headerRows: 1, widths, body, dontBreakRows: true },
          layout: {
            hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0.8 : 0.5),
            vLineWidth: () => 0,
            hLineColor: () => LINE,
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 5,
            paddingBottom: () => 5,
          },
          margin: [0, 4, 0, 12],
        };
      }
      case "code":
        return {
          table: { widths: ["*"], body: [[{ text: pdfSafe(b.text), fontSize: 8.5, preserveLeadingSpaces: true, color: INK }]] },
          layout: {
            fillColor: () => SOFT,
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            paddingLeft: () => 10,
            paddingRight: () => 10,
            paddingTop: () => 8,
            paddingBottom: () => 8,
          },
          margin: [0, 2, 0, 10],
        };
      case "quote": {
        const inner = b.blocks.map((x) => block(x, true)).filter((x): x is Content => x !== null);
        return {
          table: { widths: ["*"], body: [[{ stack: inner.length ? inner : [""], italics: true, color: MUTED }]] },
          layout: {
            vLineWidth: (i: number) => (i === 0 ? 2.5 : 0),
            vLineColor: () => ACCENT,
            hLineWidth: () => 0,
            paddingLeft: () => 12,
            paddingTop: () => 2,
            paddingBottom: () => 2,
          },
          margin: [0, 2, 0, 10],
        };
      }
      case "hr":
        return { canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 0.6, lineColor: LINE }], margin: [0, 6, 0, 12] };
      default:
        return null;
    }
  };

  const content: Content[] = [];
  const meta = metaLine(input.meta);

  // Branded cover line
  content.push({
    columns: [
      { text: [{ text: "■ ", color: ACCENT }, { text: "Ensemblis", bold: true, color: INK }], fontSize: 12, width: "*" },
      { text: input.meta?.label ? pdfSafe(input.meta.label) : "AI agent report", alignment: "right", color: MUTED, fontSize: 9, width: "auto", margin: [0, 2, 0, 0] },
    ],
  });
  content.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 1.4, lineColor: ACCENT }], margin: [0, 8, 0, 0] });
  content.push({ text: title, fontSize: 24, bold: true, color: INK, lineHeight: 1.12, margin: [0, 20, 0, 8] });
  if (meta) content.push({ text: pdfSafe(meta), color: MUTED, fontSize: 10, margin: [0, 0, 0, 4] });
  content.push({ text: AI_NOTE, color: MUTED, italics: true, fontSize: 8.5, margin: [0, 0, 0, 18] });

  for (const b of blocks) {
    const c = block(b);
    if (c !== null) content.push(c);
  }
  if (!blocks.length) content.push({ text: "This report is empty.", color: MUTED, italics: true });

  // Sources appendix
  if (sources.length) {
    content.push({ text: "Sources", fontSize: 15, bold: true, color: INK, margin: [0, 22, 0, 4], headlineLevel: 1 });
    content.push({ text: `${sources.length} numbered source${sources.length === 1 ? "" : "s"}, cited in the text as [n].`, color: MUTED, fontSize: 9, margin: [0, 0, 0, 10] });
    for (const s of sources) {
      const url = safeHref(s.url);
      const where = [sourceDomain(s), KIND_LABEL[s.kind], s.publishedAt ? prettyDate(s.publishedAt) : null].filter(Boolean).join(" · ");
      const stack: Content[] = [{ text: pdfSafe(s.title || "Untitled source"), bold: true, fontSize: 9.5, color: INK }];
      if (where) stack.push({ text: pdfSafe(where), color: MUTED, fontSize: 8.5, margin: [0, 1, 0, 0] });
      if (url) stack.push({ text: url.length > 95 ? `${url.slice(0, 94)}…` : url, link: url, color: ACCENT, fontSize: 8.5, margin: [0, 1, 0, 0] });
      if (s.snippet) {
        const snip = s.snippet.length > 320 ? `${s.snippet.slice(0, 319)}…` : s.snippet;
        stack.push({ text: pdfSafe(snip), color: MUTED, fontSize: 8.5, italics: true, margin: [0, 2, 0, 0] });
      }
      content.push({
        columns: [
          { text: `[${s.n}]`, id: `src-${s.n}`, color: ACCENT, bold: true, fontSize: 9.5, width: 26 },
          { stack, width: "*" },
        ],
        columnGap: 6,
        margin: [0, 0, 0, 9],
        unbreakable: true,
      });
    }
  }

  const footerLabel = pdfSafe(opts.footerLabel ?? `Ensemblis · ${title.length > 70 ? `${title.slice(0, 69)}…` : title}`);

  return {
    pageSize: "A4",
    pageMargins: [MARGIN, 52, MARGIN, 60],
    info: { title, author: "Ensemblis", creator: "Ensemblis", producer: "Ensemblis", subject: AI_NOTE },
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: INK, lineHeight: 1.3 },
    content,
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: footerLabel, color: MUTED, fontSize: 8, width: "*" },
        { text: `Page ${currentPage} of ${pageCount}`, color: MUTED, fontSize: 8, alignment: "right", width: "auto" },
      ],
      margin: [MARGIN, 26, MARGIN, 0],
    }),
    // Never leave a heading alone at the bottom of a page.
    pageBreakBefore: (current: { headlineLevel?: number }, followingOnPage: unknown[]) => current.headlineLevel === 1 && followingOnPage.length === 0,
  };
}

export const ROBOTO = {
  Roboto: {
    normal: "Roboto-Regular.ttf",
    bold: "Roboto-Medium.ttf",
    italics: "Roboto-Italic.ttf",
    bolditalics: "Roboto-MediumItalic.ttf",
  },
};

interface PdfDoc {
  getBlob: (cb?: (b: Blob) => void) => unknown;
}
interface PdfMakeLike {
  createPdf: (def: unknown, tableLayouts?: unknown, fonts?: unknown, vfs?: unknown) => PdfDoc;
  addVirtualFileSystem?: (vfs: unknown) => void;
  vfs?: unknown;
}

/** Render the report to a PDF Blob (browser only). */
export async function exportPdf(input: ExportInput, opts?: PdfOptions): Promise<Blob> {
  const [pm, vf] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
  const pmAny = pm as unknown as { default?: PdfMakeLike } & PdfMakeLike;
  const pdfMake: PdfMakeLike = pmAny.default ?? pmAny;
  const vfAny = vf as unknown as { default?: unknown; pdfMake?: { vfs?: unknown }; vfs?: unknown };
  const raw = (vfAny.default ?? vfAny) as { pdfMake?: { vfs?: unknown }; vfs?: unknown };
  const vfs = raw?.pdfMake?.vfs ?? raw?.vfs ?? raw;
  try {
    pdfMake.addVirtualFileSystem?.(vfs);
  } catch {
    /* older builds use the vfs argument below */
  }
  // Pass layouts, fonts and vfs explicitly so nothing depends on a global `pdfMake`.
  const doc = pdfMake.createPdf(buildPdfDefinition(input, opts), {}, ROBOTO, vfs);
  return new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PDF generation timed out")), 30_000);
    const done = (b: Blob) => {
      clearTimeout(timer);
      resolve(b);
    };
    try {
      // pdfmake 0.2 takes a callback; 0.3 returns a promise. Support both.
      const r = doc.getBlob(done) as Promise<Blob> | undefined;
      if (r && typeof (r as Promise<Blob>).then === "function") (r as Promise<Blob>).then(done, (e) => {
        clearTimeout(timer);
        reject(e);
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}
