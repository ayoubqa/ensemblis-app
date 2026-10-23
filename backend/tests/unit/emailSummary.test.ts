// The "outcome ready" e-mail quotes the report's summary as plain text: the link text stays, but no
// URL, link destination or e-mail address does, so a mail client has nothing to turn into a link.
import { describe, expect, it } from "vitest";
import { outcomeReadyEmail, summarizeReport, taskCompletedEmail, withoutLinks } from "../../src/email/templates";
import { cleanOutputWithStats } from "../../src/research/citations";

const REPORT = [
  "# Brief",
  "",
  "## Executive summary",
  "- Germany leads [1]; see [the report](https://evil.example/steal?d=secret) and https://evil.example/x?q=1.",
  "- Write to jane.doe@evil.example or [the team](mailto:ops@evil.example), or mailto:x@evil.example today.",
  "- Mirrors: //cdn.evil.example/a, www.evil.example/b and <https://evil.example/c> (https://evil.example/d).",
  "- Code `https://fake.example/x`, **www.bold.example**, ![pixel](https://evil.example/p.gif)<jane@evil.example> and [x](//evil.example/y).",
  "",
  "## Details",
  "Not in the summary: https://later.example",
].join("\n");

describe("e-mail summary", () => {
  it("keeps the text and drops every URL, link destination and e-mail address", () => {
    expect(summarizeReport(REPORT, 4)).toEqual([
      "Germany leads; see the report and.",
      "Write to or the team, or today.",
      "Mirrors:, and.",
      "Code,, and x.",
    ]);
  });

  it("leaves ordinary prose alone", () => {
    const md = "## Summary\n- Revenue grew 12% to €4.1bn in 2024 (vs. 2023) and/or 24/7 support for H<sub>2</sub>O, at **acme.example**.";
    expect(summarizeReport(md)).toEqual(["Revenue grew 12% to €4.1bn in 2024 (vs. 2023) and/or 24/7 support for H2O, at acme.example."]);
  });

  it("leaves version pins and x//y text alone: no top-level domain, no URL", () => {
    const bullets = [
      "Upgrade to react@18.3.1 and lodash@4.17.21 before launch [1].",
      "The SDK `@acme/sdk@2.1.0` adds SSO.",
      "Deploy with ssh deploy@10.0.0.5 nightly.",
      "The ratio is 1@3.5 in the deck.",
      "Ship the TCP//IP stack and the A//B test.",
    ];
    expect(summarizeReport(`## Summary\n${bullets.map((b) => `- ${b}`).join("\n")}`, 5)).toEqual([
      "Upgrade to react@18.3.1 and lodash@4.17.21 before launch.",
      "The SDK @acme/sdk@2.1.0 adds SSO.",
      "Deploy with ssh deploy@10.0.0.5 nightly.",
      "The ratio is 1@3.5 in the deck.",
      "Ship the TCP//IP stack and the A//B test.",
    ]);
  });

  it("drops a URL to a bracketed IP address, www. after a word character, and addresses glued together", () => {
    for (const [line, out] of [
      ["Data at http://[2001:db8::1]/q3.", "Data at."],
      ["Data at //[2001:db8::1] now.", "Data at now."],
      ["Mirror _www.other.example/q3", "Mirror _"],
      ["Mirrors x_www.other.example/q3 and 1www.other.example/q3", "Mirrors x_ and 1"],
      ["Write to a@one.example+b@other.example today", "Write to today"],
      ["Write to a@one.example_b@other.example today", "Write to today"],
      ["Ask __a@attacker.example%23.org@attacker.example now", "Ask now"],
    ]) {
      expect(summarizeReport(line, 1)).toEqual([out]);
    }
    const t = performance.now();
    expect(summarizeReport(`## Summary\n- ${"a@one.example+".repeat(5000)}`, 1)[0]).not.toContain(".example");
    expect(performance.now() - t).toBeLessThan(100);
  });

  it("drops a www. URL that removing an autolink joins together ('www' + autolink + '.host/path')", () => {
    const R = "research.example.org"; // a source's host: the stored-text cleaner keeps an autolink to it
    for (const [line, out] of [
      [`Full data: www<https://${R}/x>.attacker.example/c?d=ACME-SECRET.`, "Full data:."],
      [`See www<https://${R}>.attacker.example/c?d=S now`, "See now"],
      [`See WWW<ops@${R}>.attacker.example/c?d=S`, "See"],
      [`See www<https://other.example>.attacker.example/c?d=S`, "See"],
    ]) {
      const md = `# Brief\n\n## Executive summary\n\n- ${line}\n\n## Findings\n\nBody [1].`;
      expect(summarizeReport(md, 1)).toEqual([out]);
      for (const result of [md, cleanOutputWithStats(md, 3, [R]).text]) {
        expect(summarizeReport(result, 1)).toEqual([out]);
        const outcome = outcomeReadyEmail({ name: "Ada", objectiveId: "ob1", title: "EU brief", result, outcomeLabel: "Achieved", verificationLabel: "passed" });
        const task = taskCompletedEmail({ name: "Ada", taskId: "t1", title: "EU brief", result });
        for (const mail of [outcome, task]) {
          expect(mail.text).toContain(`- ${out}`);
          expect(`${mail.subject} ${mail.text} ${mail.html}`).not.toMatch(/www\.|attacker|research\.example|other\.example|mailto|@/i);
        }
      }
    }
  });

  it("stays linear on nested text that each pass would only partly unwrap, and sends nothing link-shaped", () => {
    // Each removal pass can join one more "www(" … ").x" level; the passes are capped, and what is
    // still link-shaped after the cap is dropped.
    const nested = "www(".repeat(4000) + "a@b.co" + ").x".repeat(4000);
    const t0 = performance.now();
    const out = withoutLinks(nested);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(out).not.toMatch(/www\.|@/);
  });

  it("strips again after clipping, so a cut word cannot become an address", () => {
    // "…@attacker-mail.com-2024" is not an address as written ("-" follows the TLD), but cut at 220
    // characters it ends "…@attacker-m…" or "…@attacker-mail.com…".
    for (let pad = 0; pad < 30; pad++) {
      const bullet = `Contact ${"a".repeat(180 + pad)}@attacker-mail.com-2024 for the data.`;
      const [line] = summarizeReport(`# B\n\n## Executive summary\n\n- ${bullet}\n`, 1);
      expect(line ?? "").not.toMatch(/@attacker-mail\.com(?![\p{L}\p{N}-])/u);
    }
  });

  it("the rendered e-mails link nothing from the report", () => {
    const outcome = outcomeReadyEmail({ name: "Ada", objectiveId: "ob1", title: "EU brief", result: REPORT, outcomeLabel: "Achieved", verificationLabel: "passed" });
    const task = taskCompletedEmail({ name: "Ada", taskId: "t1", title: "EU brief", result: REPORT });
    for (const mail of [outcome, task]) {
      expect(mail.text).toContain("- Germany leads; see the report and.");
      expect(mail.html).toContain("Germany leads; see the report and.");
      expect(`${mail.text} ${mail.html}`).not.toMatch(/evil|fake\.example|bold\.example|mailto|@|\/\/cdn/);
    }
  });
});
