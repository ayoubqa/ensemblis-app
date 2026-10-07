// Runs the self-contained markdown/citation suite (markdown.test.ts, which can
// also run on its own with `npx tsx`) under vitest so CI covers it.
import { expect, it } from "vitest";

it("markdown → export blocks and citation rendering", async () => {
  await expect(import("./markdown.test")).resolves.toBeDefined();
});
