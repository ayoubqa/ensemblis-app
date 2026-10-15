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
});
