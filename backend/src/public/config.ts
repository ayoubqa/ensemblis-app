// GET /api/config — public, unauthenticated deployment settings so the UI can
// adapt to how this server is configured (PublicConfig in frontend/lib/api.ts).
// Never include secrets here: only on/off flags, limits and public keys.

import { config, searchProviderLabel } from "../config";
import { aiProviderLabel } from "../tasks/llmProvider";

export function publicConfig() {
  return {
    demoMode: config.demoMode,
    inviteRequired: !!config.signupInviteCode,
    topupEnabled: config.topupEnabled && config.topupMaxCents > 0,
    topupMaxCents: config.topupEnabled ? config.topupMaxCents : 0,
    startingCreditsCents: config.startingCreditsCents,
    maxTasksPerUserPerDay: config.maxTasksPerUserPerDay,
    maxDescriptionLength: config.maxDescriptionLength,
    aiProviderLabel: aiProviderLabel(),
    sampleCatalogStats: true, // catalog ratings/success rates/task counts are seeded sample data
    // v3
    searchEnabled: config.search.provider !== "off",
    searchProviderLabel: searchProviderLabel(),
    emailEnabled: config.email.enabled,
    paymentsEnabled: config.stripe.enabled,
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
