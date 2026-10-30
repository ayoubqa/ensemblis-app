// The one Stripe API client (server-side secret key only; nothing here reaches the browser).
// STRIPE_API_BASE (tests and the E2E stub stack, scripts/stripe-stub.mjs) points it at a local stub.

import Stripe from "stripe";
import { config } from "../config";

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  if (!client) {
    const base = config.stripe.apiBase ? new URL(config.stripe.apiBase) : null;
    client = new Stripe(config.stripe.secretKey, {
      maxNetworkRetries: 1,
      timeout: 20_000,
      ...(base ? { host: base.hostname, port: Number(base.port) || (base.protocol === "https:" ? 443 : 80), protocol: base.protocol.replace(":", "") as "http" | "https" } : {}),
    });
  }
  return client;
}

/** Tests only: swap in a stub client. */
export function setStripeClientForTests(c: Stripe | null) {
  client = c;
}
