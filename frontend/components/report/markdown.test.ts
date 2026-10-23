// Unit tests for the markdown → blocks converter used by the PDF/Word exports.
// Run from frontend/:  npx tsx components/report/markdown.test.ts
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import * as docx from "docx";
import type { TaskSource } from "@/lib/api";
import { citeFromProps, remarkCitations } from "./cites";
import { buildDocxDocument } from "./export-docx";
import { buildPdfDefinition } from "./export-pdf";
import { citeNumbers, leadingTitle, linkAllowed, markdownToBlocks, withoutLeadingTitle, type Block, type Inline } from "./markdown";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    throw e;
  }
}

const only = <T extends Block["type"]>(b: Block | undefined, type: T): Extract<Block, { type: T }> => {
  assert.ok(b, `expected a ${type} block`);
  assert.equal(b.type, type);
  return b as Extract<Block, { type: T }>;
};
const text = (ins: Inline[]) => ins.map((i) => i.text).join("");

test("headings keep their depth and plain text", () => {
  const b = markdownToBlocks("# Title\n\n## Executive **summary**\n\n### Detail");
  assert.equal(b.length, 3);
  assert.deepEqual(
    b.map((x) => (x.type === "heading" ? [x.depth, text(x.inlines)] : null)),
    [
      [1, "Title"],
      [2, "Executive summary"],
      [3, "Detail"],
    ]
  );
  const h2 = only(b[1], "heading");
  assert.equal(h2.inlines.find((i) => i.text === "summary")?.bold, true);
  assert.equal(leadingTitle(b), "Title");
  assert.equal(withoutLeadingTitle(b).length, 2);
});

test("bold, italic, code, strike and links become marked inlines", () => {
  const p = only(markdownToBlocks("A **bold** and _it_ with `x()` ~~gone~~ [site](https://ex.com/a) end.")[0], "paragraph");
  const find = (t: string) => p.inlines.find((i) => i.text === t);
  assert.equal(find("bold")?.bold, true);
  assert.equal(find("it")?.italic, true);
  assert.equal(find("x()")?.code, true);
  assert.equal(find("gone")?.strike, true);
  assert.equal(find("site")?.href, "https://ex.com/a");
  assert.equal(text(p.inlines), "A bold and it with x() gone site end.");
});

test("bold italic nesting", () => {
  const p = only(markdownToBlocks("***both*** and **bold _mixed_**")[0], "paragraph");
  const both = p.inlines.find((i) => i.text === "both");
  assert.equal(both?.bold && both?.italic, true);
  const mixed = p.inlines.find((i) => i.text === "mixed");
  assert.equal(mixed?.bold && mixed?.italic, true);
});

test("unsafe link protocols are dropped", () => {
  const p = only(markdownToBlocks("[x](javascript:alert(1))")[0], "paragraph");
  assert.equal(p.inlines[0].href, undefined);
  assert.equal(text(p.inlines), "x");
});

test("citations [n], [a, b] and ranges split into cite inlines", () => {
  const p = only(markdownToBlocks("Spain grew 12% [1]. Others agree [2, 3] and [4-5].")[0], "paragraph");
  const cites = p.inlines.filter((i) => i.cite !== undefined).map((i) => i.cite);
  assert.deepEqual(cites, [1, 2, 3, 4, 5]);
  assert.equal(p.inlines.find((i) => i.cite === 2)?.text, "[2]");
  assert.equal(text(p.inlines), "Spain grew 12% [1]. Others agree [2][3] and [4][5].");
});

test("citations respect isCite (unknown numbers stay text)", () => {
  const p = only(markdownToBlocks("See [1] and [9].", { isCite: (n) => n <= 3 })[0], "paragraph");
  assert.deepEqual(
    p.inlines.filter((i) => i.cite !== undefined).map((i) => i.cite),
    [1]
  );
  assert.ok(text(p.inlines).includes("[9]"));
});

test("citations inside bold keep the bold mark; not inside links", () => {
  const p = only(markdownToBlocks("**Key fact [2]** and [link [3]](https://a.b)")[0], "paragraph");
  const c2 = p.inlines.find((i) => i.cite === 2);
  assert.equal(c2?.bold, true);
  assert.equal(p.inlines.some((i) => i.cite === 3), false);
});

test("citation defined as a reference link still counts", () => {
  const p = only(markdownToBlocks("Fact [1].\n\n[1]: https://example.com")[0], "paragraph");
  assert.equal(p.inlines.find((i) => i.cite === 1)?.text, "[1]");
});

test("nested bullet lists keep structure", () => {
  const md = "- One\n- Two\n  - Two A\n  - Two B\n    - deep\n- Three";
  const list = only(markdownToBlocks(md)[0], "list");
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 3);
  const two = list.items[1].blocks;
  assert.equal(text(only(two[0], "paragraph").inlines), "Two");
  const inner = only(two[1], "list");
  assert.equal(inner.items.length, 2);
  const deep = only(inner.items[1].blocks[1], "list");
  assert.equal(text(only(deep.items[0].blocks[0], "paragraph").inlines), "deep");
});

test("ordered lists keep their start number; task lists keep checked", () => {
  const ol = only(markdownToBlocks("3. three\n4. four")[0], "list");
  assert.equal(ol.ordered, true);
  assert.equal(ol.start, 3);
  const tl = only(markdownToBlocks("- [x] done\n- [ ] todo")[0], "list");
  assert.deepEqual(
    tl.items.map((i) => i.checked),
    [true, false]
  );
});

test("GFM tables: header, rows, alignment, inline marks, citations", () => {
  const md = "| Company | Revenue | Note |\n|:--|--:|:-:|\n| **Acme** | €12M [1] | ok |\n| Beta | €3M |\n";
  const t = only(markdownToBlocks(md)[0], "table");
  assert.deepEqual(t.align, ["left", "right", "center"]);
  assert.deepEqual(t.header.map(text), ["Company", "Revenue", "Note"]);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0][0][0].bold, true);
  assert.equal(t.rows[0][1].find((i) => i.cite === 1)?.text, "[1]");
  // Short rows are padded to the header width.
  assert.equal(t.rows[1].length, 3);
  assert.equal(text(t.rows[1][2]), "");
});

test("code blocks, quotes, rules and html", () => {
  const b = markdownToBlocks("```ts\nconst a = 1;\n```\n\n> quoted **text**\n\n---\n\n<div>raw <b>html</b></div>");
  const code = only(b[0], "code");
  assert.equal(code.text, "const a = 1;");
  assert.equal(code.lang, "ts");
  const q = only(b[1], "quote");
  assert.equal(text(only(q.blocks[0], "paragraph").inlines), "quoted text");
  only(b[2], "hr");
  assert.equal(text(only(b[3], "paragraph").inlines), "raw html");
});

test("line breaks and CRLF input", () => {
  const p = only(markdownToBlocks("line one  \r\nline two")[0], "paragraph");
  assert.equal(text(p.inlines), "line one\nline two");
});

test("citeNumbers guards against silly ranges", () => {
  assert.deepEqual(citeNumbers("1, 2"), [1, 2]);
  assert.deepEqual(citeNumbers("2–4"), [2, 3, 4]);
  assert.deepEqual(citeNumbers("1-500"), []);
  assert.deepEqual(citeNumbers("5-2"), []);
});

test("empty and whitespace input", () => {
  assert.deepEqual(markdownToBlocks(""), []);
  assert.deepEqual(markdownToBlocks("   \n\n  "), []);
});

// ---- Link allowlist in exports: links to other domains become plain text ----

const hrefsOf = (blocks: Block[]) => [...JSON.stringify(blocks).matchAll(/"href":"([^"]*)"/g)].map((m) => m[1]);

test("isLinkAllowed: only allowed links keep an href (inline, reference, autolink, encoded, e-mail)", () => {
  const md = [
    "[ok](https://www.evidence.example/a) [sub](https://data.evidence.example./b) [look](https://evidence.example.attacker.com/c?d=1) [pr](//evidence.example/x)",
    "[ref][r] [okref][o] <https://attacker.example/c?d=2> &#104;ttps://attacker.example/c?d=3 https\\://attacker.example/c?d=4 www&#46;attacker.example/c?d=5",
    "sales@attacker.example [user](https://evidence.example@attacker.example/x) ![img](https://evidence.example/i.png)",
    "",
    "[r]: https://attacker.example/c?d=6",
    "[o]: https://evidence.example/o",
  ].join("\n");
  const blocks = markdownToBlocks(md, { isLinkAllowed: (url) => linkAllowed(url, ["evidence.example"]) });
  assert.deepEqual(hrefsOf(blocks), ["https://www.evidence.example/a", "https://data.evidence.example./b", "https://evidence.example/o"]);
  const all = text(only(blocks[0], "paragraph").inlines);
  for (const t of ["look", "pr", "ref", "user", "img"]) assert.ok(all.includes(t), t);
  // A refused URL or e-mail address written as text is reduced to its domain (a PDF viewer would link it again).
  for (const t of ["https://attacker.example/c?d=3", "www.attacker.example/c?d=5", "sales@attacker.example"]) assert.ok(!all.includes(t), t);
  assert.ok(all.includes("an address at attacker.example"));
  // Without the hook every http(s) and mailto link stays (the exporters always pass one).
  assert.ok(hrefsOf(markdownToBlocks(md)).includes("https://attacker.example/c?d=6"));
});

test("PDF and Word exports link only to linkDomains, else to the sources' domains", () => {
  const sources: TaskSource[] = [{ n: 1, kind: "web", title: "S1", url: "https://evidence.example/s1", domain: "evidence.example", snippet: "", publishedAt: null }];
  const md = "Fact [1]. [ok](https://evidence.example/a) [co](https://www.company.example/b) [bad](https://attacker.example/c?d=1) www.attacker.example/x mail@attacker.example";
  const pdfLinks = (linkDomains?: string[]) =>
    [...JSON.stringify(buildPdfDefinition({ title: "T", markdown: md, sources, linkDomains })).matchAll(/"link":"([^"]*)"/g)].map((m) => m[1]);
  const docxLinks = (linkDomains?: string[]) => {
    const links: string[] = [];
    class Recorded extends docx.ExternalHyperlink {
      constructor(o: ConstructorParameters<typeof docx.ExternalHyperlink>[0]) {
        super(o);
        links.push(o.link);
      }
    }
    buildDocxDocument({ ...docx, ExternalHyperlink: Recorded }, { title: "T", markdown: md, sources, linkDomains });
    return links;
  };
  for (const links of [pdfLinks, docxLinks]) {
    // The source's own URL is linked in the sources appendix.
    assert.deepEqual(links(["evidence.example", "company.example"]).sort(), ["https://evidence.example/a", "https://evidence.example/s1", "https://www.company.example/b"]);
    assert.deepEqual(links().sort(), ["https://evidence.example/a", "https://evidence.example/s1"]);
    assert.deepEqual(links([]).sort(), ["https://evidence.example/s1"]);
  }
});

test("PDF and Word sources lists reduce link-shaped text in a source's title, snippet and label", () => {
  // A search result's title and snippet are the page's own text; a PDF viewer would link a URL or address in them.
  const source: TaskSource & { label: string } = {
    n: 1,
    kind: "web",
    title: "Q3 https://attacker.example/x?d=1 and www.attacker.example/w",
    url: "https://evidence.example/s1",
    domain: "evidence.example",
    snippet: "See https://attacker.example/s?d=2, www.attacker.example/t or ops@attacker.example for more.",
    publishedAt: null,
    label: "Mirror at www.attacker.example/m",
  };
  const input = { title: "T", markdown: "Fact [1].", sources: [source], linkDomains: ["evidence.example"] };
  const strings = (n: unknown, out: string[] = []): string[] => {
    if (typeof n === "string") out.push(n);
    else if (Array.isArray(n)) n.forEach((c) => strings(c, out));
    else if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) if (k === "text" || typeof v === "object") strings(v, out);
    return out;
  };
  const pdf = strings((buildPdfDefinition(input) as { content: unknown }).content).join("\n");
  const docxText: string[] = [];
  class Recorded extends docx.TextRun {
    constructor(o: ConstructorParameters<typeof docx.TextRun>[0]) {
      super(o);
      docxText.push(typeof o === "string" ? o : (o.text ?? ""));
    }
  }
  buildDocxDocument({ ...docx, TextRun: Recorded }, input);
  for (const [name, all] of [["pdf", pdf], ["docx", docxText.join("\n")]]) {
    assert.ok(!/https?:\/\/attacker|www\.attacker|@attacker/.test(all), `${name}: ${all}`);
    for (const t of ["Q3 attacker.example and attacker.example", "See attacker.example, attacker.example or an address at attacker.example for more.", "evidence.example · Mirror at attacker.example"])
      assert.ok(all.includes(t), `${name}: ${t}`);
    // The source's own (allowed) URL is printed as it is.
    assert.ok(all.includes("https://evidence.example/s1"), name);
  }
});

// ---- On-screen renderer: the remark plugin feeding react-markdown ----

function render(md: string, valid: number[]): string {
  const sup: Components["sup"] = ({ node, children }) => {
    const n = citeFromProps(node?.properties);
    return n === null ? createElement("sup", null, children) : createElement("cite-chip", { "data-n": n });
  };
  return renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm, [remarkCitations, { valid: new Set(valid) }]], components: { sup } }, md)
  );
}

test("react-markdown: [n] of known sources become chips, others stay text", () => {
  const html = render("Grew 38% [1] and [2, 3]; unknown [9]. **Bold [3]**", [1, 2, 3]);
  assert.equal((html.match(/<cite-chip/g) || []).length, 4);
  assert.ok(html.includes('data-n="1"') && html.includes('data-n="2"') && html.includes('data-n="3"'));
  assert.ok(html.includes("[9]"));
  assert.ok(/<strong>Bold <cite-chip data-n="3"><\/cite-chip><\/strong>/.test(html));
});

test("react-markdown: citations in tables, none inside links or code", () => {
  const html = render("| A | B |\n|--|--|\n| x [2] | `[1]` |\n\n[see [1]](https://a.b)", [1, 2]);
  assert.equal((html.match(/<cite-chip/g) || []).length, 1);
  assert.ok(html.includes("<code>[1]</code>"));
  assert.ok(html.includes('href="https://a.b"'));
});

test("react-markdown: no sources means no chips", () => {
  const html = render("Fact [1].", []);
  assert.ok(!html.includes("cite-chip"));
  assert.ok(html.includes("Fact [1]."));
});

console.log(`\n${passed} tests passed`);
