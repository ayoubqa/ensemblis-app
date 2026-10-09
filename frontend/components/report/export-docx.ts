// Word (.docx) export. Loaded lazily by <ExportMenu>; it lazy-loads `docx`.
import type * as Docx from "docx";
import { leadingTitle, markdownToBlocks, withoutLeadingTitle, type Block, type Inline } from "./markdown";
import { AI_NOTE, metaLine, prettyDate, safeHref, sortSources, sourceDomain, sourceLabel, type ExportInput } from "./shared";
import { BRAND, loadBrandMark } from "./brand";

type DocxModule = typeof Docx;
type Child = Docx.ParagraphChild;
type BodyChild = Docx.Paragraph | Docx.Table;

// Official Ensemblis palette (print-safe values; see ./brand.ts).
const ACCENT = BRAND.blueText;
const INK = BRAND.ink;
const MUTED = BRAND.slate;
const LINE = BRAND.line;
const SOFT = BRAND.soft;
const BODY_TWIPS = 9026; // A4 width minus 1" margins
const FONT = "Calibri";

/** Build the docx Document (pure apart from the module passed in; unit-testable in Node). */
export function buildDocxDocument(d: DocxModule, input: ExportInput, mark: Uint8Array | null = null): Docx.Document {
  const sources = sortSources(input.sources);
  const valid = new Set(sources.map((s) => s.n));
  const parsed = markdownToBlocks(input.markdown || "", { isCite: (n) => valid.has(n) });
  const title = (input.title || leadingTitle(parsed) || "Report").trim();
  const blocks = withoutLeadingTitle(parsed);
  const orderedRefs = new Map<number, string>(); // start number → numbering reference
  let listInstance = 0;

  const runs = (list: Inline[], base: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}): Child[] => {
    const out: Child[] = [];
    for (const i of list) {
      if (i.cite !== undefined) {
        const r = new d.TextRun({ text: `[${i.cite}]`, color: ACCENT, bold: true, size: 16, font: FONT });
        out.push(valid.has(i.cite) ? new d.InternalHyperlink({ anchor: `src_${i.cite}`, children: [r] }) : r);
        continue;
      }
      const parts = i.text.split("\n");
      parts.forEach((text, k) => {
        const opts: Docx.IRunOptions = {
          text,
          break: k > 0 ? 1 : undefined,
          bold: base.bold || i.bold || undefined,
          italics: base.italics || i.italic || undefined,
          strike: i.strike || undefined,
          size: i.code ? 19 : base.size,
          color: i.href ? ACCENT : base.color,
          underline: i.href ? {} : undefined,
          font: i.code ? "Consolas" : undefined,
          shading: i.code ? { type: d.ShadingType.CLEAR, color: "auto", fill: "EEF0F6" } : undefined,
        };
        const run = new d.TextRun(opts);
        out.push(i.href ? new d.ExternalHyperlink({ link: i.href, children: [run] }) : run);
      });
    }
    return out;
  };

  const HEADINGS = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4];

  const orderedRef = (start: number) => {
    let ref = orderedRefs.get(start);
    if (!ref) {
      ref = `ens-ol-${start}`;
      orderedRefs.set(start, ref);
    }
    return ref;
  };

  const list = (b: Extract<Block, { type: "list" }>, level: number): BodyChild[] => {
    const out: BodyChild[] = [];
    const instance = ++listInstance;
    const lvl = Math.min(level, 8);
    for (const item of b.items) {
      let first = true;
      const prefix: Child[] = item.checked === null ? [] : [new d.TextRun({ text: item.checked ? "☑ " : "☐ ", color: MUTED })];
      for (const sub of item.blocks) {
        if (sub.type === "list") {
          out.push(...list(sub, level + 1));
          continue;
        }
        if (sub.type === "paragraph" || sub.type === "heading") {
          const children = [...(first ? prefix : []), ...runs(sub.inlines, sub.type === "heading" ? { bold: true } : {})];
          out.push(
            new d.Paragraph({
              children,
              ...(first
                ? b.ordered
                  ? { numbering: { reference: orderedRef(b.start), level: lvl, instance } }
                  : { bullet: { level: lvl } }
                : { indent: { left: 720 * (lvl + 1) } }),
              spacing: { after: 60 },
            })
          );
          first = false;
          continue;
        }
        out.push(...block(sub, level + 1));
        first = false;
      }
      if (first) {
        // Empty item: keep the bullet so numbering stays right.
        out.push(
          new d.Paragraph({
            children: prefix,
            ...(b.ordered ? { numbering: { reference: orderedRef(b.start), level: lvl, instance } } : { bullet: { level: lvl } }),
          })
        );
      }
    }
    return out;
  };

  const border = (color = LINE, size = 4) => ({ style: d.BorderStyle.SINGLE, size, color });
  const none = { style: d.BorderStyle.NONE, size: 0, color: "FFFFFF" };

  const table = (b: Extract<Block, { type: "table" }>): Docx.Table => {
    const cols = Math.max(1, b.header.length);
    const colW = Math.floor(BODY_TWIPS / cols);
    const align = (c: number) => (b.align[c] === "right" ? d.AlignmentType.RIGHT : b.align[c] === "center" ? d.AlignmentType.CENTER : d.AlignmentType.LEFT);
    const cell = (inl: Inline[], c: number, header: boolean) =>
      new d.TableCell({
        children: [new d.Paragraph({ children: runs(inl, { bold: header, size: 19 }), alignment: align(c), spacing: { before: 0, after: 0 } })],
        width: { size: colW, type: d.WidthType.DXA },
        shading: header ? { type: d.ShadingType.CLEAR, color: "auto", fill: SOFT } : undefined,
        margins: { top: 70, bottom: 70, left: 110, right: 110 },
      });
    return new d.Table({
      width: { size: BODY_TWIPS, type: d.WidthType.DXA },
      columnWidths: Array.from({ length: cols }, () => colW),
      borders: { top: border(), bottom: border(), left: none, right: none, insideHorizontal: border(), insideVertical: none },
      rows: [
        new d.TableRow({ tableHeader: true, children: b.header.map((c, i) => cell(c, i, true)) }),
        ...b.rows.map((r) => new d.TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
      ],
    });
  };

  const block = (b: Block, level = 0): BodyChild[] => {
    switch (b.type) {
      case "heading":
        return [new d.Paragraph({ heading: HEADINGS[Math.min(b.depth, 4)], children: runs(b.inlines), keepNext: true })];
      case "paragraph":
        return [new d.Paragraph({ children: runs(b.inlines), spacing: { after: 140 } })];
      case "list":
        return list(b, level);
      case "table":
        return [table(b), new d.Paragraph({ children: [], spacing: { after: 80 } })];
      case "code":
        return b.text.split("\n").map(
          (line, i, all) =>
            new d.Paragraph({
              children: [new d.TextRun({ text: line || " ", font: "Consolas", size: 18 })],
              shading: { type: d.ShadingType.CLEAR, color: "auto", fill: SOFT },
              spacing: { before: i === 0 ? 80 : 0, after: i === all.length - 1 ? 160 : 0 },
            })
        );
      case "quote":
        return b.blocks.flatMap((x) =>
          x.type === "paragraph"
            ? [
                new d.Paragraph({
                  children: runs(x.inlines, { italics: true, color: MUTED }),
                  indent: { left: 360 },
                  border: { left: { style: d.BorderStyle.SINGLE, size: 18, color: ACCENT, space: 10 } },
                  spacing: { after: 120 },
                }),
              ]
            : block(x, level)
        );
      case "hr":
        return [new d.Paragraph({ children: [], border: { bottom: border(LINE, 6) }, spacing: { after: 200 } })];
      default:
        return [];
    }
  };

  // ---- Cover: the official mark (never redrawn) + the wordmark set in text ----
  const note = input.meta?.note || AI_NOTE;
  const body: BodyChild[] = [
    new d.Paragraph({
      children: [
        ...(mark
          ? [new d.ImageRun({ type: "png", data: mark, transformation: { width: 22, height: 22 }, altText: { name: "Ensemblis", description: "Ensemblis logo", title: "Ensemblis" } }), new d.TextRun({ text: "  " })]
          : []),
        new d.TextRun({ text: "ENSEMBLIS", bold: true, size: 20, color: INK, characterSpacing: 40 }),
        new d.TextRun({ text: `\t${input.meta?.label || "Ensemblis report"}`, size: 18, color: MUTED }),
      ],
      tabStops: [{ type: d.TabStopType.RIGHT, position: BODY_TWIPS }],
      border: { bottom: { style: d.BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
      spacing: { after: 360 },
    }),
    new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun({ text: title })] }),
  ];
  const meta = metaLine(input.meta);
  if (meta) body.push(new d.Paragraph({ children: [new d.TextRun({ text: meta, color: MUTED, size: 20 })], spacing: { after: 60 } }));
  body.push(new d.Paragraph({ children: [new d.TextRun({ text: note, italics: true, color: MUTED, size: 17 })], spacing: { after: 320 } }));

  for (const b of blocks) body.push(...block(b));
  if (!blocks.length) body.push(new d.Paragraph({ children: [new d.TextRun({ text: "This report is empty.", italics: true, color: MUTED })] }));

  // ---- Sources appendix ----
  if (sources.length) {
    body.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun({ text: "Sources" })], keepNext: true, spacing: { before: 360 } }));
    body.push(
      new d.Paragraph({
        children: [new d.TextRun({ text: `${sources.length} numbered source${sources.length === 1 ? "" : "s"}, cited in the text as [n].`, color: MUTED, size: 18 })],
        spacing: { after: 160 },
      })
    );
    for (const s of sources) {
      const url = safeHref(s.url);
      const where = [sourceDomain(s), sourceLabel(s), s.publishedAt ? prettyDate(s.publishedAt) : null].filter(Boolean).join(" · ");
      body.push(
        new d.Paragraph({
          keepNext: true,
          spacing: { after: 20 },
          children: [
            new d.Bookmark({ id: `src_${s.n}`, children: [new d.TextRun({ text: `[${s.n}] `, bold: true, color: ACCENT })] }),
            new d.TextRun({ text: s.title || "Untitled source", bold: true }),
          ],
        })
      );
      const line: Child[] = [];
      if (where) line.push(new d.TextRun({ text: where, color: MUTED, size: 18 }));
      if (url) {
        if (where) line.push(new d.TextRun({ text: " · ", color: MUTED, size: 18 }));
        line.push(new d.ExternalHyperlink({ link: url, children: [new d.TextRun({ text: url, color: ACCENT, underline: {}, size: 18 })] }));
      }
      if (line.length) body.push(new d.Paragraph({ children: line, spacing: { after: 20 }, keepNext: !!s.snippet }));
      if (s.snippet) body.push(new d.Paragraph({ children: [new d.TextRun({ text: s.snippet, italics: true, color: MUTED, size: 18 })], spacing: { after: 160 } }));
      else body.push(new d.Paragraph({ children: [], spacing: { after: 100 } }));
    }
  }

  const levels = (start: number) =>
    Array.from({ length: 9 }, (_, level) => ({
      level,
      format: level % 3 === 1 ? d.LevelFormat.LOWER_LETTER : level % 3 === 2 ? d.LevelFormat.LOWER_ROMAN : d.LevelFormat.DECIMAL,
      text: `%${level + 1}.`,
      start: level === 0 ? start : 1,
      alignment: d.AlignmentType.START,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    }));

  return new d.Document({
    creator: "Ensemblis",
    title,
    description: note,
    styles: {
      default: {
        document: { run: { font: FONT, size: 21, color: INK }, paragraph: { spacing: { line: 288 } } },
        title: { run: { font: FONT, size: 48, bold: true, color: INK }, paragraph: { spacing: { after: 120 } } },
        heading1: { run: { font: FONT, size: 32, bold: true, color: INK }, paragraph: { spacing: { before: 320, after: 120 } } },
        heading2: { run: { font: FONT, size: 26, bold: true, color: INK }, paragraph: { spacing: { before: 240, after: 100 } } },
        heading3: { run: { font: FONT, size: 23, bold: true, color: INK }, paragraph: { spacing: { before: 200, after: 80 } } },
        heading4: { run: { font: FONT, size: 21, bold: true, color: MUTED }, paragraph: { spacing: { before: 160, after: 60 } } },
        hyperlink: { run: { color: ACCENT, underline: { type: d.UnderlineType.SINGLE } } },
      },
    },
    numbering: { config: Array.from(orderedRefs.entries()).map(([start, reference]) => ({ reference, levels: levels(start) })) },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 } } },
        footers: {
          default: new d.Footer({
            children: [
              new d.Paragraph({
                tabStops: [{ type: d.TabStopType.RIGHT, position: BODY_TWIPS }],
                children: [
                  new d.TextRun({ text: `Ensemblis · ${title.length > 70 ? `${title.slice(0, 69)}…` : title}`, size: 16, color: MUTED }),
                  new d.TextRun({ children: ["\tPage ", d.PageNumber.CURRENT, " of ", d.PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });
}

/** Render the report to a .docx Blob (browser only). */
export async function exportDocx(input: ExportInput): Promise<Blob> {
  const mod = (await import("docx")) as unknown as DocxModule & { default?: DocxModule };
  const d = (mod.Document ? mod : mod.default) as DocxModule;
  const doc = buildDocxDocument(d, input, await loadBrandMark("bytes"));
  return d.Packer.toBlob(doc);
}
