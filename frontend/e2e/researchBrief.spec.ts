// The research brief, end to end in the browser: launched and approved with
// the keyboard only, then the console must say honestly what happened —
// research and its provider, evidence provenance, per-criterion verdicts with
// evidence chips, claim types, open issues, usage (estimated or measured), the
// result state, and whether the output came from the mock model.
//
// NOT REAL RESEARCH: web search goes to the local search stub
// (backend/scripts/search-stub.mjs, fixed fixtures). `npm run e2e` uses the
// MOCK model; `npm run e2e:prod-like` runs the real OpenAI-compatible provider
// code against a local Groq-format stub that replays the mock's text. Neither
// is evidence of a real model's behaviour (see DEPLOYMENT.md §5 for the live run).
import { expect, test } from "@playwright/test";
import { expectStatus, fillCompanyContext, horizontalOverflow, PROD_LIKE, signUpViaUI, tabTo, uniqueEmail } from "./helpers";

const STATEMENT = "Brief: the European data center market for liquid cooling, where demand is growing and what constrains it";
const CONSTRAINTS = "EU sources only; no paid databases";
const CRITERIA = ["Every key finding cites an external source", "Names the three largest European data center markets", "States the open questions and evidence gaps"];

test("research brief: keyboard-only launch and approval → research, evidence, per-criterion verification, open issues, usage, honest labels", async ({ page }) => {
  await signUpViaUI(page, { name: "Robin Keller", company: "Northwind Cooling", email: uniqueEmail("brief") });
  await fillCompanyContext(page);

  // ---- Define the brief with the keyboard only (Tab / arrow keys / typing / Enter). ----
  await page.goto("/objectives/new");
  await expect(page.getByTestId("objective-statement")).toHaveValue("");
  await tabTo(page, page.getByTestId("objective-statement"));
  await page.keyboard.type(STATEMENT);

  // The deliverable radio group: Tab reaches the selected option, an arrow key moves the choice.
  const memo = page.getByRole("radio", { name: /^Decision memo/ });
  const brief = page.getByRole("radio", { name: /^Research brief \(evidence-backed\)/ });
  await expect(memo).toBeChecked();
  await tabTo(page, memo);
  await page.keyboard.press("ArrowDown");
  await expect(brief).toBeChecked();
  await expect(brief).toBeFocused();

  await tabTo(page, page.getByTestId("constraints-input"));
  await page.keyboard.type(CONSTRAINTS);
  await expect(page.getByTestId("constraints-input")).toHaveValue(CONSTRAINTS);

  const add = page.getByRole("button", { name: "Add a criterion" });
  for (const [i, c] of CRITERIA.entries()) {
    await tabTo(page, add);
    await page.keyboard.press("Enter");
    const input = page.getByTestId("criterion-input").nth(i);
    await expect(input).toBeFocused(); // focus moves into the new criterion
    await page.keyboard.type(c);
  }
  await expect(page.getByTestId("criterion-input")).toHaveCount(CRITERIA.length);

  await tabTo(page, page.getByTestId("submit-objective"));
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/objectives\/(?!new)[^/]+$/);
  await expect(page.getByTestId("objective-console")).toBeVisible();

  // ---- The Chief of Staff plans; approve with the keyboard. ----
  await expectStatus(page, "WAITING_FOR_APPROVAL");
  const approve = page.getByTestId("approval-card").getByRole("button", { name: /^Approve/ });
  await tabTo(page, approve, { max: 250 });
  await page.keyboard.press("Enter");

  await expectStatus(page, "COMPLETED", 120_000);

  // ---- Result state: its own label, separate from the outcome. ----
  const status = page.getByTestId("execution-status");
  await expect(status).toHaveAttribute("data-result-state", /^verified(_with_warnings)?$/);
  const resultState = (await status.getAttribute("data-result-state")) ?? "";
  await expect(page.getByTestId("result-state")).toHaveAttribute("data-state", resultState);
  await expect(page.getByTestId("result-state")).toContainText(/Verified/);
  await expect(page.getByTestId("live-card")).toHaveAttribute("data-result-state", resultState);

  // ---- Plan: the research step says it searched, with which outcome; each step names its model. ----
  await expect(page.locator('[data-testid="research-badge"][data-research="ok"]').first()).toBeVisible();
  const stepMeta = page.getByTestId("step-meta");
  expect(await stepMeta.count()).toBeGreaterThanOrEqual(3);

  // ---- Evidence: provenance on every external source (provider, query, retrieval time). ----
  const webMeta = page.getByTestId("evidence-meta").filter({ hasText: "via Tavily search snippet" });
  expect(await webMeta.count()).toBeGreaterThanOrEqual(3);
  await expect(webMeta.first()).toContainText("query “");
  await expect(webMeta.first()).toContainText("retrieved");
  await expect(page.getByTestId("evidence-meta").filter({ hasText: "Provided, not retrieved" }).first()).toBeVisible();

  // ---- Verification: one verdict per criterion, with the evidence it relies on; typed claims. ----
  const verdicts = page.getByTestId("criterion-assessment");
  await expect(verdicts).toHaveCount(CRITERIA.length);
  expect(await verdicts.locator(".cs-evchip").count()).toBeGreaterThan(0);
  for (const c of CRITERIA) await expect(verdicts.filter({ hasText: c })).toHaveCount(1);
  const claimTypes = page.getByTestId("claim-type");
  expect(await claimTypes.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="claim-type"][data-type="source"]').first()).toBeAttached();

  // ---- Open issues and usage. ----
  const issues = page.getByTestId("open-issues");
  await expect(issues).toBeVisible();
  await expect(issues).toHaveAttribute("data-count", /^\d+$/);
  const usage = page.getByTestId("usage-panel");
  await expect(usage).toBeVisible();
  await expect(usage).toContainText("Web searches");
  await expect(usage).toContainText("Tavily");

  if (PROD_LIKE) {
    // The OpenAI-compatible stub reports usage (x_groq.usage): tokens are measured, not estimated — and no mock label.
    // (The stub replays the mock model's text over the real wire format: this is still not a real model.)
    await expect(page.getByTestId("mock-tag")).toHaveCount(0);
    await expect(usage).not.toContainText("est.");
    for (const m of await stepMeta.all()) await expect(m).not.toContainText("est.");
  } else {
    // The mock model: its output is labelled as test output, and its token counts are estimates.
    await expect(page.getByTestId("mock-tag")).toBeVisible();
    await expect(page.getByTestId("mock-tag")).toHaveText("Mock AI — test output");
    await expect(usage).toContainText("est.");
    await expect(stepMeta.first()).toContainText("est.");
  }

  // ---- Phone width: the console holds up with no horizontal scroll. ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("objective-console")).toBeVisible();
  await expect(page.getByTestId("criterion-assessment")).toHaveCount(CRITERIA.length);
  expect(await horizontalOverflow(page), "the console overflows horizontally at 390px").toBeLessThanOrEqual(0);
});
