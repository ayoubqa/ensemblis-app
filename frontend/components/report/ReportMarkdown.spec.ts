// Links in report markdown come from model output, which may carry a prompt-injected link: only an
// absolute http(s) URL or an in-page #anchor is rendered as a link; anything else is its text.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TaskSource } from "@/lib/api";
import { CitedMarkdown, isLinkableHref, type ReportMarkdownProps } from "./ReportMarkdown";

// The markdown is the element's child (`children` is required by the props type, not passed as one).
const html = (md: string, sources: TaskSource[] = []) => renderToStaticMarkup(createElement(CitedMarkdown, { sources } as ReportMarkdownProps, md));
const SOURCE: TaskSource = { n: 1, kind: "web", title: "Research", url: "https://research.example.org/r", domain: "research.example.org", snippet: "", publishedAt: null };

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
