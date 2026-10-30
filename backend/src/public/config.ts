// GET /api/config — public, unauthenticated deployment settings so the UI can
// adapt to how this server is configured (PublicConfig in frontend/lib/api.ts).
// Never include secrets here: only on/off flags, limits and public keys.

import { config, modelEndpoint } from "../config";
import { aiConfigProblem, aiProviderLabel, currentProvider } from "../ai/llmProvider";
import { effectiveSearchProvider, searchCustomEndpoint, searchEnabled, searchProviderLabel } from "../research/search";
import { VERIFICATION_COST_CENTS } from "../org/registry";
import { minimumPlanCost } from "../engine/budget";
import { publicPlans, subscriptionsAvailable } from "../billing/plans";

export function publicConfig() {
  // Why model calls can't work right now (unknown provider, missing key, mock where forbidden), or null.
  // Names environment variables only — never a key.
  const aiProblem = aiConfigProblem();
  const mockAI = (() => {
    try {
      return currentProvider() === "mock";
    } catch {
      return false;
    }
  })();
  return {
    demoMode: config.demoMode,
    inviteRequired: !!config.signupInviteCode,
    topupEnabled: config.topupEnabled && config.topupMaxCents > 0,
    topupMaxCents: config.topupEnabled ? config.topupMaxCents : 0,
    startingCreditsCents: config.startingCreditsCents,
    maxTasksPerUserPerDay: config.maxTasksPerUserPerDay,
    maxDescriptionLength: config.maxDescriptionLength,
    aiProviderLabel: aiProviderLabel(),
    aiConfigured: aiProblem === null,
    aiProblem,
    sampleCatalogStats: false, // v4: no seeded catalog statistics are shown anywhere
    mockAI,
    // Where model calls go (config.ts modelEndpoint): "stub" also for the mock — neither is a real model. Never the host.
    aiEndpoint: mockAI ? "stub" : modelEndpoint()?.kind ?? "hosted",
    verificationCostCents: VERIFICATION_COST_CENTS,
    // Credits needed before any objective can be planned (engine/budget.ts).
    minimumPlanCents: minimumPlanCost(),
    // v3. The provider actually used: SEARCH_PROVIDER=tavily without a key means Wikipedia.
    searchEnabled: searchEnabled(),
    searchProvider: effectiveSearchProvider(),
    searchProviderLabel: searchProviderLabel(),
    // TAVILY_BASE_URL sends web search to a stub or proxy: its sources are not live Tavily results.
    searchCustomEndpoint: searchCustomEndpoint(),
    emailEnabled: config.email.enabled,
    paymentsEnabled: config.stripe.enabled,
    // Monthly plans from the server catalogue (billing/plans.ts): prices, allowances, limits, and whether each
    // can be bought on this server. No Stripe IDs.
    subscriptionsEnabled: subscriptionsAvailable(),
    plans: publicPlans(),
    creditPacks: config.creditPacks.map((p) => ({
      id: p.id,
      label: p.label,
      priceCents: p.priceCents,
      credits: p.credits,
      ...(p.popular ? { popular: true } : {}),
    })),
    // Off while sign-up is invite-only (a trial can be claimed without the code).
    guestTrialEnabled: config.guest.enabled && config.guest.globalPerDay > 0 && !config.signupInviteCode,
    guestCreditsCents: config.guest.creditsCents,
    turnstileSiteKey: config.turnstile.enabled ? config.turnstile.siteKey : null,
    followupCostCents: config.followupCostCents,
    clarifyEnabled: config.clarifyEnabled,
    maxAttachments: config.attachments.maxPerTask,
    maxAttachmentChars: config.attachments.maxChars,
    devTestRunsPerDay: config.devTestRunsPerDay,
  };
}
