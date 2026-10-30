// Operator tool for monthly plans in Stripe TEST mode (refuses live keys). Reads STRIPE_SECRET_KEY,
// STRIPE_WEBHOOK_SECRET and the STRIPE_PRICE_* / PLAN_* settings from the environment like the API does.
//
//   npm run ops:stripe-test -- check [--webhook-url https://<api>/api/billing/stripe/webhook]
//   npm run ops:stripe-test -- setup [--webhook-url <url> --secret-file <path>]
//   npm run ops:stripe-test -- relay [--to http://localhost:4000/api/billing/stripe/webhook] [--since-minutes 5]
//
// See docs/billing/stripe-test-mode-validation.md for the whole validation run.

import Stripe from "stripe";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { config } from "../config";
import { assertTestKey, checkTestMode, relayOnce, setupTestMode, type Finding, type RelayState } from "../billing/stripeTestMode";

const MARK = { ok: "✔", fail: "✘", info: "·" } as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** stripe-node ignores HTTPS_PROXY; behind a proxy (e.g. a sandboxed container) route its requests through it. */
function client(): Stripe {
  const proxied = process.env.HTTPS_PROXY || process.env.https_proxy;
  const dispatcher = proxied ? new ProxyAgent(proxied) : undefined;
  return new Stripe(config.stripe.secretKey, {
    maxNetworkRetries: 1,
    timeout: 20_000,
    ...(dispatcher
      ? { httpClient: Stripe.createFetchHttpClient(((url: string, init: RequestInit) => undiciFetch(url, { ...(init as object), dispatcher })) as unknown as typeof fetch) }
      : {}),
  });
}

function print(findings: Finding[]): boolean {
  for (const f of findings) console.log(`${MARK[f.level]} ${f.what}`);
  return !findings.some((f) => f.level === "fail");
}

async function main() {
  const command = process.argv[2];
  assertTestKey(config.stripe.secretKey);
  const stripe = client();

  if (command === "check") {
    const passed = print(await checkTestMode(stripe, { webhookUrl: arg("webhook-url") }));
    console.log(passed ? "\nTest-mode configuration: OK" : "\nTest-mode configuration: problems above (✘)");
    if (!passed) process.exitCode = 1;
    return;
  }

  if (command === "setup") {
    const { findings, env } = await setupTestMode(stripe, { webhookUrl: arg("webhook-url"), secretFile: arg("secret-file") });
    const passed = print(findings);
    console.log("\nSet these on the API (IDs only, not secrets):");
    for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
    if (!passed) process.exitCode = 1;
    return;
  }

  if (command === "relay") {
    const to = arg("to") ?? `http://localhost:${Number(process.env.PORT) || 4000}/api/billing/stripe/webhook`;
    if (!/^whsec_/.test(config.stripe.webhookSecret)) throw new Error("Set STRIPE_WEBHOOK_SECRET (any whsec_… value) to the one the local API uses.");
    const state: RelayState = { since: Math.floor(Date.now() / 1000) - 60 * Number(arg("since-minutes") ?? 0), done: new Set(), attempts: new Map() };
    console.log(`Relaying test-mode events to ${to} (Ctrl-C to stop)…`);
    let stop = false;
    process.on("SIGINT", () => (stop = true));
    while (!stop) {
      try {
        for (const r of await relayOnce(stripe, state, { to, secret: config.stripe.webhookSecret })) console.log(`→ ${r.type} ${r.id}: ${r.status}`);
      } catch (err) {
        console.error(`relay: ${err instanceof Error ? err.message : err}`);
        if (err instanceof Error && /only delivers to this machine/.test(err.message)) throw err;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return;
  }

  throw new Error("Usage: npm run ops:stripe-test -- check|setup|relay [options] (see src/ops/stripeTestMode.ts)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
