// Runs in CI on every pull request: every file in content/blog must pass the publishing checks
// (lib/blog/validate.ts). Warnings are printed, errors fail the build. `npm run content:check` runs just this.
import { describe, expect, it } from "vitest";
import { readContent } from "./posts";

describe("content/blog", () => {
  const report = readContent();

  it("every article passes the publishing checks", () => {
    if (report.warnings.length) console.warn(`content/blog warnings:\n- ${report.warnings.join("\n- ")}`);
    expect(report.errors).toEqual([]);
  });

  it("no article is published without a person's approval and a fact-check date", () => {
    for (const p of report.posts.filter((p) => p.status === "published")) {
      expect(p.approvedBy, p.slug).toBeTruthy();
      expect(p.factCheckedAt, p.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
