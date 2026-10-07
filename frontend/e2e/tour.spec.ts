// Optional visual tour (E2E_TOUR=1 npm run e2e -- tour): runs one objective and
// saves full-page screenshots of every main screen to test-results/tour/ for
// design review. Skipped in normal runs.
import { expect, test } from "@playwright/test";
import { defineObjective, expectStatus, signUpViaUI, uniqueEmail } from "./helpers";

test.skip(!process.env.E2E_TOUR, "visual tour runs only with E2E_TOUR=1");

for (const scheme of ["dark", "light"] as const) {
  test(`screens (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1400, height: 900 });
    const shot = (name: string) => page.screenshot({ path: `test-results/tour/${scheme}-${name}.png`, fullPage: true });
    await page.goto("/");
    await shot("01-landing");
    await signUpViaUI(page, { name: "Jordan Lee", company: "Atlas Logistics", email: uniqueEmail(`tour-${scheme}`) });
    await shot("02-context-empty");
    await page.getByLabel("What the company does").fill("Atlas Logistics runs temperature-controlled freight for pharma distributors across Spain and Portugal. We operate 180 trucks.");
    await page.getByLabel("Customers / ICP").fill("Pharmaceutical wholesalers and hospital groups. Operations directors buy.");
    await page.getByLabel("Business goals").fill("Grow revenue 25% in 2027 and enter France.");
    await page.getByTestId("save-context").click();
    await page.goto("/dashboard");
    await shot("03-briefing-fresh");
    await page.goto("/ai-team");
    await shot("04-ai-team");
    await page.goto("/objectives/new");
    await page.getByTestId("objective-statement").fill("Assess whether we should enter the French pharma cold-chain market in 2027 and how");
    await page.getByTestId("suggest-criteria").click();
    await expect(page.getByTestId("criterion-input").first()).toBeVisible();
    await shot("05-define-outcome");
    await page.getByTestId("submit-objective").click();
    await page.waitForURL(/\/objectives\/(?!new)[^/]+$/);
    await expectStatus(page, "WAITING_FOR_APPROVAL");
    await shot("06-plan-approval");
    await page.getByTestId("approval-card").getByRole("button", { name: /^Approve/ }).click();
    await expect(page.locator('[data-testid="plan-step"][data-status="COMPLETED"]').first()).toBeVisible({ timeout: 30_000 });
    await shot("07-executing");
    await expectStatus(page, "COMPLETED", 120_000);
    await shot("08-completed");
    await page.goto("/dashboard");
    await shot("09-briefing");
    await page.goto("/objectives");
    await shot("10-objectives");
    await page.goto("/approvals");
    await shot("11-approvals");
    await page.goto("/usage");
    await shot("12-usage");
    await page.goto("/context");
    await shot("13-context");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    await shot("14-mobile-briefing");
  });
}
