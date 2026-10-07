// Unit tests for the markdown → blocks converter used by the PDF/Word exports.
// Run from frontend/:  npx tsx components/report/markdown.test.ts
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { citeFromProps, remarkCitations } from "./cites";
import { citeNumbers, leadingTitle, markdownToBlocks, withoutLeadingTitle, type Block, type Inline } from "./markdown";

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
