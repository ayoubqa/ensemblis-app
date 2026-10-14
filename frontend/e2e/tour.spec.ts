// Optional visual tour (E2E_TOUR=1 npm run e2e -- tour): runs one objective and
// saves full-page screenshots of every main screen (desktop, tablet and phone,
// dark and light) to test-results/tour/ for design review, failing on any
// horizontal overflow. Skipped in normal runs.
import { expect, test, type Page } from "@playwright/test";
import { defineObjective, expectStatus, signUpViaUI, uniqueEmail } from "./helpers";

test.skip(!process.env.E2E_TOUR, "visual tour runs only with E2E_TOUR=1");

for (const scheme of ["dark", "light"] as const) {
  test(`screens (${scheme})`, async ({ page, browser }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1400, height: 900 });
    // Capture only once the page has loaded: no skeleton placeholders left.
    const settle = async (p: Page) => {
      await expect(p.locator(".sk")).toHaveCount(0, { timeout: 20_000 });
      await p.waitForTimeout(300);
    };
    const shot = async (name: string) => {
      await settle(page);
      await page.screenshot({ path: `test-results/tour/${scheme}-${name}.png`, fullPage: true });
    };
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
    const objectiveUrl = new URL(page.url()).pathname;
    await expectStatus(page, "WAITING_FOR_APPROVAL");
    await shot("06-plan-approval");
    await page.getByTestId("approval-card").getByRole("button", { name: /^Approve/ }).click();
    await expect(page.locator('[data-testid="plan-step"][data-status="COMPLETED"]').first()).toBeVisible({ timeout: 30_000 });
    await shot("07-executing");
    await expectStatus(page, "COMPLETED", 120_000);
    await shot("08-completed");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const href = (await page.getByTestId("share-link").getAttribute("href")) ?? "";
    const anon = await browser.newContext({ colorScheme: scheme, reducedMotion: "reduce", viewport: { width: 1400, height: 900 } });
    const pub = await anon.newPage();
    await pub.goto(href);
    await expect(pub.getByTestId("shared-report")).toBeVisible();
    await settle(pub);
    await pub.screenshot({ path: `test-results/tour/${scheme}-15-shared-result.png`, fullPage: true });
    await anon.close();
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
    await page.goto("/reports");
    await shot("12b-reports");
    await page.goto("/exceptions");
    await shot("12c-exceptions");
    await page.goto("/how-it-works");
    await shot("00b-how-it-works");

    // Tablet and phone: the main screens must hold up without horizontal scroll.
    for (const [w, h, tag] of [
      [820, 1180, "tablet"],
      [390, 844, "mobile"],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      for (const [path, name] of [
        ["/", "landing"],
        ["/dashboard", "home"],
        ["/objectives/new", "define"],
        [objectiveUrl, "console"],
        ["/reports", "reports"],
        ["/context", "context"],
        ["/ai-team", "ai-team"],
        ["/usage", "usage"],
      ] as const) {
        await page.goto(path);
        await settle(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} overflows at ${w}px`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `test-results/tour/${scheme}-${tag}-${name}.png`, fullPage: true });
      }
    }

    // A second organization with no Company Context: the Chief of Staff stops and asks.
    const second = await browser.newContext({ colorScheme: scheme, reducedMotion: "reduce", viewport: { width: 1400, height: 900 } });
    const p2 = await second.newPage();
    await signUpViaUI(p2, { name: "Sam Rivera", company: "", email: uniqueEmail(`tour2-${scheme}`) });
    await defineObjective(p2, "Find the best channel partners for our product in France and rank the top five");
    await expect(p2.getByTestId("execution-status")).toHaveAttribute("data-status", "BLOCKED", { timeout: 60_000 });
    await expect(p2.getByText("Sent to the Chief of Staff")).toHaveCount(0, { timeout: 10_000 });
    await settle(p2);
    await p2.screenshot({ path: `test-results/tour/${scheme}-16-exception.png`, fullPage: true });
    await second.close();
  });
}
