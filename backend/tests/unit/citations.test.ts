// Citation hygiene: a [n] that survives must point at a real source, a range
// is never quietly re-attributed, and an invented URL is never clickable.
import { describe, expect, it } from "vitest";
import { cleanOutput, cleanOutputWithStats, stripInvalidCitations, unlinkUnknownUrls } from "../../src/research/citations";

describe("stripInvalidCitations", () => {
  it("drops out-of-range numbers in ',' and ';' lists", () => {
    expect(stripInvalidCitations("A [2, 9] and B [7].", 5)).toBe("A [2] and B.");
    expect(stripInvalidCitations("A [2; 9].", 5)).toBe("A [2].");
    expect(stripInvalidCitations("A [9; 12] here.", 5)).toBe("A here.");
    expect(stripInvalidCitations("Valid [1; 3] and [2, 4].", 5)).toBe("Valid [1; 3] and [2, 4].");
    expect(stripInvalidCitations("Zero [0] cited.", 5)).toBe("Zero cited.");
  });

  it("drops a range that reaches outside the sources instead of clamping it", () => {
    expect(stripInvalidCitations("Growth [2-8].", 3)).toBe("Growth.");
    expect(stripInvalidCitations("Growth [1, 2–8].", 3)).toBe("Growth [1].");
    expect(stripInvalidCitations("Growth [1-3].", 3)).toBe("Growth [1-3].");
    expect(stripInvalidCitations("Growth [3-1].", 3)).toBe("Growth [1–3].");
  });

  it("removes reference lines for sources that don't exist", () => {
    const md = "Text [1].\n\n## Sources\n- [1] Real report\n- [9] Invented report\n1. [8] Another invention\n[2] Real too";
    expect(stripInvalidCitations(md, 2)).toBe("Text [1].\n\n## Sources\n- [1] Real report\n[2] Real too");
  });

  it("leaves code, links and footnote-style definitions alone", () => {
    expect(stripInvalidCitations("Use `arr[9]` and\n```\nx[12]\n```", 3)).toBe("Use `arr[9]` and\n```\nx[12]\n```");
    expect(stripInvalidCitations("[9](https://example.org) and [9]: def", 3)).toBe("[9](https://example.org) and [9]: def");
  });
});

describe("unlinkUnknownUrls", () => {
  const allowed = ["research.example.org", "example.com"];

  it("turns markdown links and images on unknown domains into text", () => {
    expect(unlinkUnknownUrls("See [the report](https://fake.com/report) now.", allowed)).toBe("See the report now.");
    expect(unlinkUnknownUrls("![chart](https://fake.com/c.png)", allowed)).toBe("chart");
    expect(unlinkUnknownUrls("[ok](https://research.example.org/x)", allowed)).toBe("[ok](https://research.example.org/x)");
    expect(unlinkUnknownUrls("[sub](https://docs.example.com/x)", allowed)).toBe("[sub](https://docs.example.com/x)");
  });

  it("wraps bare and www. URLs on unknown domains in backticks so they can't be autolinked", () => {
    expect(unlinkUnknownUrls("See https://fake-report.com/x and www.madeup.io.", allowed)).toBe("See `https://fake-report.com/x` and `www.madeup.io`.");
    expect(unlinkUnknownUrls("Metadata at http://169.254.169.254/latest/meta-data/, really.", allowed)).toBe("Metadata at `http://169.254.169.254/latest/meta-data/`, really.");
    expect(unlinkUnknownUrls("<https://fake.com/a>", allowed)).toBe("`https://fake.com/a`");
    expect(unlinkUnknownUrls("A link [https://fake.com/a](https://fake.com/a).", allowed)).toBe("A link `https://fake.com/a`.");
    expect(unlinkUnknownUrls("(see https://fake.com/a)", allowed)).toBe("(see `https://fake.com/a`)");
  });

  it("never allows a protocol-relative or non-http(s) destination, whatever its host", () => {
    // Links and images keep their text: "//host" (also as escapes or references), other schemes.
    for (const dest of [
      "//research.example.org/x",
      String.raw`\/\/evil.example/x`,
      String.raw`/\evil.example`,
      String.raw`\\\\evil.example`,
      "&#47;&#47;evil.example",
      "<//evil.example> \"t\"",
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "&#106;avascript&colon;alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "mailto:x@example.com",
      "https:/evil.example",
    ]) {
      expect(unlinkUnknownUrls(`See [the page](${dest}) now.`, allowed)).toBe("See the page now.");
    }
    expect(unlinkUnknownUrls("![pixel](//evil.example/p.gif)", allowed)).toBe("pixel");
    expect(unlinkUnknownUrls("[https://fake.com/a](//fake.com/a)", allowed)).toBe("`https://fake.com/a`");
    // A reference definition's destination goes in backticks, as an unknown https:// one does.
    expect(unlinkUnknownUrls("See [r].\n\n[r]: //evil.example/x", allowed)).toBe("See [r].\n\n[r]: `//evil.example/x`");
    expect(unlinkUnknownUrls('[r]: javascript:alert(1) "t"', allowed)).toBe('[r]: `javascript:alert(1)` "t"');
    expect(unlinkUnknownUrls("- [r]:\n  //evil.example/x", allowed)).toBe("- [r]:\n  `//evil.example/x`");
    expect(unlinkUnknownUrls("[r]: https://fake.com/x", allowed)).toBe("[r]: `https://fake.com/x`");
    // Autolinks with another scheme are wrapped like unknown https:// ones.
    expect(unlinkUnknownUrls("<mailto:x@example.com> or <javascript:alert(1)>", allowed)).toBe("`mailto:x@example.com` or `javascript:alert(1)`");
    // Unchanged: relative links, footnotes, a backslash path that isn't "//", allowed https://, code.
    for (const md of [
      "[a](/about), [b](#sec), [c](report.pdf), [d](?q=1) and [e](./a:b)",
      String.raw`[a](\\evil.example) and [b](\/path)`,
      "[^1]: //cdn.example/x is a path",
      "[r]: https://research.example.org/x\n\n[ok](https://research.example.org/x) <https://example.com/a>",
      "Use `[a](//evil.example)` here.",
    ]) {
      expect(unlinkUnknownUrls(md, allowed)).toBe(md);
    }
  });

  it("treats a line as a reference definition only when CommonMark does", () => {
    // Prose that only looks like one: the rest of the line isn't empty or a title, or the line starts
    // or ends at inline code. Unchanged, nothing counted.
    for (const md of [
      "[Update]: Revenue: up 5% year on year [1].",
      "[1]: Eurostat: Energy statistics 2024",
      "- [Risk]: Note: currency exposure.",
      "> [Quote]: Source: annual report",
      "[Status]:\nPending: board approval.",
      "## Key findings\n[Finding 1]: Pricing: €20–€40 per seat [2].\n[Finding 2]: Demand: strong in DE [3].",
      "Run `npm ci` [step 2]: Note: this is slow.",
      "Run `npm ci` [step 2]: Note:",
      "[Step]: Run: `npm ci`",
      '[r]: //evil.example "t" and more', // a paragraph to CommonMark, not a link
    ]) {
      expect(cleanOutputWithStats(md, 3, allowed)).toEqual({ text: md, removedCitations: 0, unlinkedUrls: 0 });
    }
    // Definitions in containers, with a title (escaped quotes, over two lines) or a destination glued to code.
    expect(unlinkUnknownUrls("> - [r]: javascript:x", allowed)).toBe("> - [r]: `javascript:x`");
    expect(unlinkUnknownUrls("1.  > [r]: //x", allowed)).toBe("1.  > [r]: `//x`");
    expect(unlinkUnknownUrls("[r]: //evil.example 'it\\'s'", allowed)).toBe("[r]: `//evil.example` 'it\\'s'");
    expect(unlinkUnknownUrls('[r]: //evil.example "two\nlines"\r\nNext.', allowed)).toBe('[r]: `//evil.example` "two\nlines"\r\nNext.');
    expect(unlinkUnknownUrls("[r]: //evil.example`x`", allowed)).toBe("[r]: `//evil.example``x`");
  });

  it("stays linear on adversarial input", () => {
    const fast = (run: () => unknown) => {
      const t = performance.now();
      run();
      return performance.now() - t;
    };
    // Container markers that each could take the following space (exponential backtracking once).
    for (const unit of ["> ", ">\t", "-  ", "1.  ", "> - 1. "]) {
      expect(fast(() => cleanOutputWithStats(`${unit.repeat(40)}x`, 3, allowed))).toBeLessThan(50);
    }
    // Long runs of spaces around a definition's destination that isn't followed by a title.
    for (const md of [`[a]:${" ".repeat(20000)}x y`, `[a]:${" ".repeat(20000)}\n${" ".repeat(20000)}x y`]) {
      expect(fast(() => unlinkUnknownUrls(md, allowed))).toBeLessThan(50);
    }
  });

  it("keeps bare URLs on allowed domains, and doesn't touch code", () => {
    const md = "Source: https://research.example.org/eu and https://www.example.com/a. Code: `https://fake.com` stays.";
    expect(unlinkUnknownUrls(md, allowed)).toBe(md);
    expect(unlinkUnknownUrls("<https://research.example.org/x>", allowed)).toBe("<https://research.example.org/x>");
  });
});

describe("cleanOutputWithStats", () => {
  it("counts removed citations and unlinked URLs; cleanOutput returns the same text", () => {
    const md = [
      "# Brief",
      "",
      "Germany leads [1, 7] and the Nordics grow [2; 9]. See https://invented.example.net/study and [a page](https://fake.com/p).",
      "",
      "- [1] Real source",
      "- [8] Invented source",
    ].join("\n");
    const r = cleanOutputWithStats(md, 2, ["research.example.org"]);
    expect(r.removedCitations).toBe(3);
    expect(r.unlinkedUrls).toBe(2);
    expect(r.text).toBe(
      ["# Brief", "", "Germany leads [1] and the Nordics grow [2]. See `https://invented.example.net/study` and a page.", "", "- [1] Real source"].join("\n")
    );
    expect(cleanOutput(md, 2, ["research.example.org"])).toBe(r.text);
  });

  it("is idempotent and reports nothing for clean text", () => {
    const md = "Claim [1]. See `https://x.example` and https://research.example.org/a.";
    const once = cleanOutputWithStats(md, 1, ["research.example.org"]);
    expect(once).toEqual({ text: md, removedCitations: 0, unlinkedUrls: 0 });
    const dirty = "A [5] https://fake.com/x";
    const first = cleanOutput(dirty, 1, []);
    expect(cleanOutputWithStats(first, 1, [])).toEqual({ text: first, removedCitations: 0, unlinkedUrls: 0 });
  });

  it("counts each unsafe destination once and is idempotent on them", () => {
    const md = "A [x](//evil.example) and ![y](javascript:alert(1)) <mailto:a@b.example> [r].\n\n[r]: //evil.example";
    const once = cleanOutputWithStats(md, 1, ["research.example.org"]);
    expect(once).toEqual({ text: "A x and y `mailto:a@b.example` [r].\n\n[r]: `//evil.example`", removedCitations: 0, unlinkedUrls: 4 });
    expect(cleanOutputWithStats(once.text, 1, ["research.example.org"])).toEqual({ text: once.text, removedCitations: 0, unlinkedUrls: 0 });
  });
});
