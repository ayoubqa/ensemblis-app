// The core loop, end to end through the browser: define an outcome → the Chief
// of Staff plans it → approve → watch it execute (refreshing mid-run) →
// verification → evidence → measured outcome → share a public link. Then a
// second organization must not be able to see it.
import { expect, test } from "@playwright/test";
import { defineObjective, expectStatus, signUpViaAPI, signUpViaUI, uniqueEmail } from "./helpers";

test("define → plan → approve → execute (with refresh) → verify → share", async ({ page, browser, request }) => {
  await signUpViaUI(page, { name: "Alex Morgan", company: "Northwind Cooling", email: uniqueEmail("owner") });

  // Company Context: the evidence the AI Team works from (web search is off in E2E).
  await page.getByLabel("What the company does").fill(
    "Northwind Cooling builds liquid cooling systems for high-density data centers. Our systems cut cooling energy use by 30% compared with air cooling."
  );
  await page.getByLabel("Customers / ICP").fill("Colocation operators and hyperscale data center builders in Europe. Heads of facilities decide.");
  await page.getByLabel("Markets & geographies").fill("We sell in Germany today. We want to expand to two more European markets in 2027.");
  await page.getByLabel("Business goals").fill("Reach 40 enterprise customers in Europe by the end of 2027.");
  await page.getByTestId("save-context").click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();

  await defineObjective(page, "Recommend the two most promising European expansion markets for our liquid cooling product in 2027", { suggest: true });

  // The Chief of Staff plans; review-the-plan autonomy waits for approval.
  await expectStatus(page, "WAITING_FOR_APPROVAL");
  const steps = page.getByTestId("plan-step");
  expect(await steps.count()).toBeGreaterThanOrEqual(3);
  const approval = page.getByTestId("approval-card");
  await expect(approval).toBeVisible();
  await approval.getByRole("button", { name: /^Approve/ }).click();

  // Executing: refresh in the middle — the console rebuilds from the persistent event log.
  await expectStatus(page, /RUNNING|VERIFYING/, 30_000);
  await expect(page.locator('[data-testid="plan-step"][data-status="COMPLETED"]').first()).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId("objective-console")).toBeVisible();
  await expect(page.locator('[data-testid="plan-step"][data-status="COMPLETED"]').first()).toBeVisible();

  await expectStatus(page, "COMPLETED", 120_000);
  await expect(page.getByTestId("execution-status")).toHaveAttribute("data-verification", /^PASS/);
  expect(await page.locator('[data-testid="plan-step"][data-status="COMPLETED"]').count()).toBe(await steps.count());

  // Verification gate, evidence and measured outcome are all on the console.
  expect(await page.getByTestId("verification-check").count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("evidence-list").locator("li").first()).toBeVisible();
  await expect(page.getByTestId("outcome-panel")).toBeVisible();
  const title = (await page.locator(".ohead h1").textContent())?.trim() ?? "";
  expect(title.length).toBeGreaterThan(5);

  // Share a public, read-only link and open it signed out.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = page.getByTestId("share-link");
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href")) ?? "";
  expect(href).toMatch(/\/r\/[A-Za-z0-9_-]{16,}$/);
  const objectiveUrl = page.url();

  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto(href);
  const shared = pub.getByTestId("shared-report");
  await expect(shared).toBeVisible();
  await expect(shared.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(shared.locator("#sr-outcome")).toHaveText("Success criteria");
  await expect(shared.getByText(/success criteria met/)).toBeVisible();
  // Never shown publicly: prices or the owner's account.
  await expect(shared.getByText(/€\s?\d/)).toHaveCount(0);
  await anon.close();

  // Tenant isolation: another organization gets "not found", not the objective.
  const other = await browser.newContext();
  await signUpViaAPI(request, other, { name: "Riley Other", email: uniqueEmail("other") });
  const otherPage = await other.newPage();
  await otherPage.goto(objectiveUrl);
  await expect(otherPage.getByText("Objective not found")).toBeVisible();
  await otherPage.goto("/objectives");
  await expect(otherPage.getByText("No objectives yet")).toBeVisible();
  await other.close();

  // Turning sharing off takes effect immediately.
  await page.getByRole("button", { name: "Stop sharing" }).click();
  await expect(page.getByTestId("share-link")).toHaveCount(0);
  const gone = await browser.newContext();
  const gonePage = await gone.newPage();
  await gonePage.goto(href);
  await expect(gonePage.getByText("This link isn't active")).toBeVisible();
  await gone.close();
});
