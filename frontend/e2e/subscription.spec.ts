// Monthly plans through the browser, end to end, against the local Stripe STUB (backend/scripts/stripe-stub.mjs):
// pricing → Stripe-style hosted checkout → pay → back on Usage, confirmed by the signed webhooks → cancel and keep
// → upgrade → a downgrade scheduled for renewal → a failed renewal → the billing portal and back.
// Nothing reaches Stripe and no card is charged. Opt-in, like the tour:
//
//   E2E_STRIPE=1 npm run e2e -- subscription
//   E2E_STRIPE=1 E2E_SCREENSHOTS=/some/dir npm run e2e -- subscription   (also saves screenshots)
import { expect, test, type Page } from "@playwright/test";
import { signUpViaAPI, uniqueEmail } from "./helpers";

test.skip(process.env.E2E_STRIPE !== "1", "subscriptions run only with E2E_STRIPE=1 (local Stripe stub)");

const shots = process.env.E2E_SCREENSHOTS;
async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

/** Reloads Usage until the plan panel shows `text` (webhooks arrive a moment after the redirect). */
async function untilPlanShows(page: Page, text: string | RegExp) {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("plan")).toContainText(text, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test("subscribe, manage and renew a monthly plan", async ({ page, request, context }) => {
  await signUpViaAPI(request, context, { name: "Plan Buyer", email: uniqueEmail("plan") });

  // Pricing: the three plans come from the server catalogue.
  await page.goto("/pricing");
  const plans = page.getByRole("region", { name: "Monthly plans" });
  await expect(plans.getByRole("heading", { name: "Starter" })).toBeVisible();
  await expect(plans).toContainText("€29");
  await expect(plans).toContainText("€99");
  await expect(plans).toContainText("€299");
  await expect(plans).toContainText("15,000 credits each month");
  await plans.scrollIntoViewIfNeeded();
  await shot(page, "pricing-plans-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "pricing-plans-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });

  // Checkout on the stub's hosted page; cancelling first changes nothing.
  await plans.getByRole("button", { name: "Choose Growth" }).click();
  await page.waitForURL(/\/checkout\/cs_test/);
  await expect(page.getByText("Stripe test stub.")).toBeVisible();
  const stub = new URL(page.url()).origin;
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForURL(/\/pricing\?subscription=cancelled/);
  await expect(page.getByText("Checkout was cancelled. Nothing was charged.")).toBeVisible();

  await page.getByRole("button", { name: "Choose Growth" }).click();
  await page.waitForURL(/\/checkout\/cs_test/);
  await page.getByRole("button", { name: "Pay (test)" }).click();
  await page.waitForURL(/\/usage/);
  // The plan appears only once the webhooks have confirmed the payment.
  const panel = page.getByTestId("plan");
  await expect(panel).toContainText("Active", { timeout: 30_000 });
  await expect(panel).toContainText("Growth plan");
  await expect(panel).toContainText("15,000 of 15,000 plan credits left");
  await expect(page.getByTestId("balance")).toHaveText(/25,000 credits/); // 10,000 starting + 15,000 plan credits
  await shot(page, "usage-plan-active");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "usage-plan-active-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });

  // Cancel at period end, then keep it.
  await panel.getByRole("button", { name: "Cancel plan" }).click();
  await panel.getByRole("button", { name: "Yes, cancel" }).click();
  await expect(panel).toContainText("Ends at renewal");
  await expect(panel).toContainText("it won't renew");
  await panel.getByRole("button", { name: "Keep my plan" }).click();
  await expect(panel).toContainText("Active");

  // Upgrade: applies once the prorated invoice is paid.
  await panel.getByRole("button", { name: /Upgrade to Business/ }).click();
  await untilPlanShows(page, "Business plan");
  await expect(panel).not.toContainText("of 15,000");

  // Downgrade: scheduled for the next renewal.
  await panel.getByRole("button", { name: /Downgrade to Starter/ }).click();
  await expect(panel).toContainText("Changes to Starter at the next renewal");
  await shot(page, "usage-plan-downgrade-scheduled");

  // A failed renewal: no new credits, a clear message.
  const subs = (await (await request.get(`${stub}/__stub/subscriptions`)).json()) as { id: string }[];
  await request.post(`${stub}/__stub/renew/${subs[0].id}?paid=0`);
  await untilPlanShows(page, "Payment failed");
  await expect(panel).toContainText("Your last payment failed.");
  await shot(page, "usage-plan-payment-failed");

  // Billing portal and back.
  await panel.getByRole("button", { name: "Manage billing" }).click();
  await page.waitForURL(/\/portal\//);
  await page.getByRole("link", { name: "Return to Ensemblis" }).click();
  await page.waitForURL(/\/usage/);
  await expect(page.getByTestId("plan")).toBeVisible();
});
