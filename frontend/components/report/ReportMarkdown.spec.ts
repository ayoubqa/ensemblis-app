// Links in report markdown come from model output, which may carry a prompt-injected link: only an
// in-page #anchor or an absolute http(s) URL on a domain the report may link to (its linkDomains,
// else its sources' domains) is rendered as a link; anything else is its text.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as docx from "docx";
import { describe, expect, it } from "vitest";
import type { TaskSource } from "@/lib/api";
import { buildDocxDocument } from "./export-docx";
import { buildPdfDefinition } from "./export-pdf";
import { CitedMarkdown, CiteProvider, ReportMarkdown, isLinkableHref, type ReportMarkdownProps } from "./ReportMarkdown";
import { ReportView } from "./ReportView";
import { linkAllowed, linkAllowlist, markdownToBlocks } from "./markdown";

// The markdown is the element's child (`children` is required by the props type, not passed as one).
const html = (md: string, sources: TaskSource[] = [], linkDomains?: string[] | null) =>
  renderToStaticMarkup(createElement(CitedMarkdown, { sources, linkDomains } as ReportMarkdownProps, md));
const SOURCE: TaskSource = { n: 1, kind: "web", title: "Research", url: "https://research.example.org/r", domain: "research.example.org", snippet: "", publishedAt: null };
/** Every href and src in rendered HTML, entities decoded. */
const refs = (out: string) => [...out.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const external = (out: string) => refs(out).filter((h) => !h.startsWith("#"));

describe("isLinkableHref", () => {
  it("keeps absolute http(s) URLs and in-page anchors", () => {
    for (const href of ["https://research.example.org/a?b=1", "http://example.com", "HTTPS://Example.com/x", "#user-content-fn-1"]) expect(isLinkableHref(href)).toBe(true);
  });
  it("refuses everything else", () => {
    for (const href of [
      "//attacker.example/c?d=secret",
      "///attacker.example",
      "https:attacker.example",
      "https:\\\\attacker.example",
      "https:/\\attacker.example",
      " https://example.com",
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "mailto:someone@example.com",
      "/relative/path",
      "relative",
      "",
      null,
      undefined,
    ])
      expect(isLinkableHref(href), String(href)).toBe(false);
  });
});

describe("ReportMarkdown links", () => {
  it("renders a protocol-relative or script link as its text only", () => {
    const out = html("See [the full dataset](//attacker.example/c?d=ACME-secret-pricing) and [run](javascript:alert(1)) or [doc](/docs/x).");
    expect(out).not.toContain("<a");
    expect(out).not.toContain("attacker.example");
    expect(out).toContain("the full dataset");
    expect(out).toContain("run");
    expect(out).toContain("doc");
  });

  it("keeps absolute https links (in a new tab), footnote anchors and citation chips", () => {
    const out = html("Market data [1] from [the source](https://research.example.org/r).[^a]\n\n[^a]: A footnote.", [SOURCE]);
    expect(out).toMatch(/<a href="https:\/\/research\.example\.org\/r" target="_blank" rel="noopener noreferrer">the source<\/a>/);
    expect(out).toMatch(/<a href="#user-content-fn-a"[^>]*>/);
    expect(out).not.toMatch(/<a href="#user-content-fn-a"[^>]*target=/);
    // The citation chip for [1].
    expect(out).toMatch(/<a href="https:\/\/research\.example\.org\/r"[^>]*aria-label="Source 1: Research"/);
  });
});

describe("linkAllowlist", () => {
  it("is linkDomains when given (even empty), else the sources' domains and URL hosts, normalised", () => {
    expect(linkAllowlist(["WWW.Company.Example.", "research.example.org", ""], [SOURCE])).toEqual(["company.example", "research.example.org"]);
    expect(linkAllowlist([], [SOURCE])).toEqual([]);
    expect(linkAllowlist(null, [SOURCE, { ...SOURCE, n: 2, domain: null, url: "https://www.Stats.example.net/t" }])).toEqual(["research.example.org", "stats.example.net"]);
    expect(linkAllowlist(undefined, [{ ...SOURCE, url: "not a url", domain: null }])).toEqual([]);
    expect(linkAllowlist(undefined, undefined)).toEqual([]);
  });
  it("keeps public suffixes (they allow their exact host only, see linkAllowed) and a shared-hosting host as it is", () => {
    expect(linkAllowlist(["co.uk", "WWW.Co.Uk.", "com.au", "gov.br", "acme.co.uk", "www.vendor.github.io"], [])).toEqual(["co.uk", "com.au", "gov.br", "acme.co.uk", "www.vendor.github.io"]);
    // A path-style S3 source: its host is shared by every bucket.
    const s3: TaskSource = { ...SOURCE, url: "https://s3.amazonaws.com/vendor-bucket/whitepaper.pdf", domain: "s3.amazonaws.com" };
    expect(linkAllowlist(null, [s3])).toEqual(["s3.amazonaws.com"]);
    expect(linkAllowed("https://attacker-logs.s3.amazonaws.com/x?d=ACME-SECRET", linkAllowlist(null, [s3]))).toBe(false);
  });
});

describe("linkAllowed", () => {
  const allowed = ["evidence.example", "research.example.org"];
  it("keeps in-page anchors and URLs on an allowed domain or its subdomains", () => {
    for (const href of [
      "#user-content-fn-1",
      "https://evidence.example/a?b=1#c",
      "http://evidence.example",
      "HTTPS://Evidence.Example/X",
      "https://www.evidence.example/x",
      "https://data.evidence.example/x",
      "https://a.b.research.example.org/x",
      "https://evidence.example./x",
      "https://evidence.example:8443/x",
    ])
      expect(linkAllowed(href, allowed), href).toBe(true);
  });
  it("refuses lookalikes, other hosts and anything a reader could resolve elsewhere", () => {
    for (const href of [
      "https://evidence.example.attacker.com/c?d=secret",
      "https://attacker-evidence.example/x",
      "https://evidenceexample/x",
      "https://xevidence.example/x",
      "https://attacker.example/?u=https://evidence.example",
      "//evidence.example/x",
      "https:evidence.example/x",
      "https:/evidence.example/x",
      "https://evidence.example@attacker.example/x",
      "https://user:pw@evidence.example/x",
      "https://attacker.example\\@evidence.example/x",
      "https://evidence.example\\@attacker.example/x",
      "https://attacker.example%2F@evidence.example/x",
      "https://evidence%2Eexample/x",
      "https://еvidence.example/x",
      "https://xn--vidence-7ve.example/x",
      "https://0x7f.1/x",
      "https://[::1]/x",
      "https://evidence.example /x",
      "https://evid\tence.example/x",
      "javascript:alert(1)//evidence.example",
      "mailto:a@evidence.example",
      "ftp://evidence.example/x",
      "/relative",
      "",
      null,
    ])
      expect(linkAllowed(href, allowed), String(href)).toBe(false);
    expect(linkAllowed("https://evidence.example/x", [])).toBe(false);
  });
  it("lets a public suffix or a shared-hosting domain allow its exact host only, never its subdomains", () => {
    expect(linkAllowed("https://attacker.co.uk/c?d=SECRET", ["co.uk", "research.example.org"])).toBe(false);
    expect(linkAllowed("https://co.uk/x", ["co.uk"])).toBe(true);
    // Evidence from www.gov.uk (domain "gov.uk"): GOV.UK itself stays linkable, other *.gov.uk sites do not.
    expect(linkAllowed("https://www.gov.uk/guidance/vat", ["gov.uk"])).toBe(true);
    expect(linkAllowed("https://attacker.gov.uk/x", ["gov.uk"])).toBe(false);
    expect(linkAllowed("https://shop.acme.co.uk/x", ["acme.co.uk"])).toBe(true);
    expect(linkAllowed("https://attacker-logs.s3.amazonaws.com/x?d=ACME-SECRET", ["s3.amazonaws.com"])).toBe(false);
    expect(linkAllowed("https://www.s3.amazonaws.com/x", ["s3.amazonaws.com"])).toBe(false);
    expect(linkAllowed("https://s3.amazonaws.com/vendor-bucket/whitepaper.pdf", ["s3.amazonaws.com"])).toBe(true);
    expect(linkAllowed("https://vendor.github.io/docs", ["vendor.github.io"])).toBe(true);
    expect(linkAllowed("https://Vendor.GitHub.io./docs", ["vendor.github.io"])).toBe(true);
    for (const href of ["https://attacker.vendor.github.io/x", "https://www.vendor.github.io/x", "https://attacker.github.io/x", "https://github.io.attacker.example/x"])
      expect(linkAllowed(href, ["vendor.github.io"]), href).toBe(false);
    expect(linkAllowed("https://attacker.github.io/x", ["github.io"])).toBe(false);
  });
});

describe("ReportMarkdown link allowlist", () => {
  const ALLOWED = ["evidence.example"];
  const md = [
    "[ok](https://evidence.example/a) [sub](https://data.evidence.example/b) [www](https://www.evidence.example/c) [dot](https://evidence.example./d)",
    "[look](https://evidence.example.attacker.com/c?d=secret) [pr](//evidence.example/x) [user](https://evidence.example@attacker.example/x)",
    "&#104;ttps://attacker.example/c?d=1 https\\://attacker.example/c?d=2 https&#58;//attacker.example/c?d=3 www&#46;attacker.example/c?d=4 www\\.attacker.example/c?d=5",
    "`code` https://attacker.example/c?d=6 <https://attacker.example/c?d=7> <https&#58;//attacker.example/c?d=8> sales@attacker.example",
    "[ref][r] [okref][o] ![img](https://evidence.example/i.png) ![x][i]",
    "",
    "[r]: https://attacker.example/c?d=9",
    "[o]: https://evidence.example/o",
    "[i]: https://attacker.example/i.png",
  ].join("\n");

  it("links only to allowed domains, however the markdown spelled the URL; never loads an image", () => {
    const out = html(md, [], ALLOWED);
    expect(external(out).sort()).toEqual(
      ["https://data.evidence.example/b", "https://evidence.example./d", "https://evidence.example/a", "https://evidence.example/o", "https://www.evidence.example/c"].sort()
    );
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/href="[^"]*attacker/);
    // The text of an unlinked link stays readable.
    for (const t of ["look", "pr", "user", "ref", "img"]) expect(out).toContain(t);
  });

  it("entity- or escape-encoded autolinks on an allowed domain still link (the rule reads the decoded URL)", () => {
    const out = html("&#104;ttps://evidence.example/e and https&#58;//evidence.example/f", [], ALLOWED);
    expect(external(out)).toEqual(["https://evidence.example/e", "https://evidence.example/f"]);
  });

  it("falls back to the sources' domains, and to none without sources", () => {
    const text = "[a](https://research.example.org/a) [b](https://evidence.example/b) www.research.example.org/c";
    expect(external(html(text, [SOURCE])).filter((h) => h !== SOURCE.url)).toEqual(["https://research.example.org/a", "http://www.research.example.org/c"]);
    expect(external(html(text))).toEqual([]);
    // Given linkDomains win over the sources (the citation chip still links its own source).
    const out = html(`${text} [1]`, [SOURCE], ["evidence.example"]);
    expect(external(out)).toEqual(["https://evidence.example/b", SOURCE.url as string]);
    expect(out).toMatch(/aria-label="Source 1: Research"/);
    expect(external(html(text, [SOURCE], []))).toEqual([]);
  });

  it("reads the allowlist from the surrounding CiteProvider, unless given its own", () => {
    const text = "[a](https://evidence.example/a) [b](https://company.example/b)";
    const inProvider = (linkDomains?: string[]) =>
      renderToStaticMarkup(
        createElement(
          CiteProvider,
          { sources: [SOURCE], linkDomains: ["evidence.example"] } as ComponentProps<typeof CiteProvider>,
          createElement(ReportMarkdown, { linkDomains } as ReportMarkdownProps, text)
        )
      );
    expect(external(inProvider())).toEqual(["https://evidence.example/a"]);
    expect(external(inProvider(["company.example"]))).toEqual(["https://company.example/b"]);
    // No provider at all: its own sources' domains.
    expect(external(renderToStaticMarkup(createElement(ReportMarkdown, { sources: [SOURCE] } as ReportMarkdownProps, "[r](https://research.example.org/r) [a](https://evidence.example/a)")))).toEqual([
      "https://research.example.org/r",
    ]);
  });

  it("ReportView passes linkDomains to every section", () => {
    const out = renderToStaticMarkup(
      createElement(ReportView, {
        markdown: "# T\n\n## One\n\n[a](https://evidence.example/a) [x](https://attacker.example/x)\n\n## Two\n\n[b](https://www.evidence.example/b)",
        sources: [SOURCE],
        linkDomains: ["evidence.example"],
        sourcesPanel: false,
      })
    );
    const links = external(out);
    expect(links).toContain("https://evidence.example/a");
    expect(links).toContain("https://www.evidence.example/b");
    expect(links.join(" ")).not.toMatch(/attacker/);
  });
});

// A PDF viewer (Chrome's, Acrobat) links URL and e-mail text by itself: an export prints a refused
// link's URL, or a URL or address written as text, on a host the report may not link to as its
// registrable domain only. Allowed URLs and the evidence links stay as they are.
describe("exports print no link-shaped text for a host the report may not link to", () => {
  const A = "attacker.example";
  const md = [
    `Full data: https://${A}/c?d=ACME-Q3-REVENUE and [https://${A}/c?d=SECRET2](https://${A}/c?d=SECRET2)`,
    `Contact ACME-Q3-REVENUE-12M@${A} or <mailto:ACME-secret@${A}>. Pricing detail at https://acme-q3-revenue-12m.attacker.com/x, www.${A}/w?d=SECRET3 and https://x.y.attacker.co.uk/q.`,
    `Split by marks: https://${A}/**c?d=SECRET4** and ACME-SECRET5@**${A}**; in code \`https://${A}/c?d=SECRET6\`.`,
    `Kept: [the source](https://research.example.org/r), https://research.example.org/data and press@research.example.org [1].`,
  ].join("\n\n");
  const LEAK = /https?:\/\/(?:[\w-]+\.)*attacker|www\.attacker|@attacker|ACME|SECRET/i;
  const REDUCED = ["Full data: attacker.example and attacker.example", "Contact an address at attacker.example or an address at attacker.example.", "Pricing detail at attacker.com, attacker.example and attacker.co.uk."];

  it("in the blocks both exporters print", () => {
    const blocks = markdownToBlocks(md, { isLinkAllowed: (url) => linkAllowed(url, ["research.example.org"]) });
    const out = JSON.stringify(blocks);
    expect(out).not.toMatch(LEAK);
    for (const t of REDUCED) expect(out).toContain(t);
    expect(out).toContain('"href":"https://research.example.org/r"');
    expect(out).toContain("https://research.example.org/data");
    expect(out).toContain("press@research.example.org");
    // Without the hook the text stays as written.
    expect(JSON.stringify(markdownToBlocks(md))).toMatch(LEAK);
  });

  it("in the PDF", () => {
    const def = JSON.stringify(buildPdfDefinition({ title: "T", markdown: md, sources: [SOURCE], linkDomains: ["research.example.org"] }));
    expect(def).not.toMatch(LEAK);
    for (const t of REDUCED) expect(def).toContain(t);
    const links = [...def.matchAll(/"link":"([^"]*)"/g)].map((m) => m[1]);
    expect(links.sort()).toEqual(["https://research.example.org/data", "https://research.example.org/r", "https://research.example.org/r"]);
    expect(def).toContain('"linkToDestination":"src-1"');
  });

  it("in the Word document", () => {
    const texts: string[] = [];
    const links: string[] = [];
    class Run extends docx.TextRun {
      constructor(o: ConstructorParameters<typeof docx.TextRun>[0]) {
        super(o);
        texts.push(typeof o === "string" ? o : (o.text ?? ""));
      }
    }
    class Hyperlink extends docx.ExternalHyperlink {
      constructor(o: ConstructorParameters<typeof docx.ExternalHyperlink>[0]) {
        super(o);
        links.push(o.link);
      }
    }
    buildDocxDocument({ ...docx, TextRun: Run, ExternalHyperlink: Hyperlink }, { title: "T", markdown: md, sources: [SOURCE], linkDomains: ["research.example.org"] });
    const all = texts.join("");
    expect(all).not.toMatch(LEAK);
    for (const t of REDUCED) expect(all).toContain(t);
    expect(links.sort()).toEqual(["https://research.example.org/data", "https://research.example.org/r", "https://research.example.org/r"]);
  });

  it("however the text spells it: characters a PDF drops, joined shapes, a URL a viewer ends early, mailto escapes", () => {
    const reduced = (text: string) => JSON.stringify(markdownToBlocks(text, { isLinkAllowed: (url) => linkAllowed(url, ["research.example.org"]) }));
    // The PDF strips the joiner and the emoji (pdfSafe); the Word file keeps the emoji, which then ends the domain.
    expect(reduced(`ht‍tps://${A}/c?d=SECRET https:/\u{1F600}/${A}/c?d=SECRET a@research.example.org‍.${A}`)).toContain(
      '"attacker.example attacker.example an address at attacker.example"'
    );
    expect(reduced(`ACME@${A}.\u{1F600}research.example.org`)).not.toMatch(LEAK);
    // An address that runs into a URL, a URL after an "@", an allowed URL that pdf.js ends at a bracket.
    for (const text of [`a@${A}https://evil.example/c?d=SECRET`, `x@https://${A}/c?d=SECRET`, `https://research.example.org/x[y](mailto:a@${A}) end`])
      expect(reduced(text), text).not.toMatch(LEAK);
    // pdf.js links "mailto:" and whatever follows; a mail client decodes "%40".
    expect(reduced(`Write to mailto:press@research.example.org?cc=x%40${A.replace(".", "%2E")} now`)).toContain('"Write to an address at attacker.example now"');
    expect(reduced("mailto:press@research.example.org")).toContain('"mailto:press@research.example.org"');
  });
});
