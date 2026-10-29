// Runs in CI on every pull request: every file in content/blog must pass the publishing checks
// (lib/blog/validate.ts). Warnings are printed, errors fail the build. `npm run content:check` runs just this.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeMarkdown } from "./markdown";
import { localImageSize } from "./images";
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

  it("every site image an article uses exists, and its size is known (no layout shift)", () => {
    for (const p of report.posts) {
      for (const im of analyzeMarkdown(p.body).images.filter((i) => i.url.startsWith("/"))) {
        expect(fs.existsSync(path.join(process.cwd(), "public", im.url)), `${p.slug}: ${im.url}`).toBe(true);
        expect(localImageSize(im.url), `${p.slug}: ${im.url} has no readable width/height (use SVG or PNG)`).not.toBeNull();
      }
    }
  });
});
