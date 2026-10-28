// Product analytics, provider-agnostic and OFF by default.
//
//   track("cta_click", { from: "home-hero", to: "/access" })
//
// Nothing is collected unless NEXT_PUBLIC_ANALYTICS names a provider at build time. Today the only adapter is
// "vercel" (Vercel Web Analytics: cookie-less, no personal data; enable it in the Vercel project first — see
// docs/growth/04-measurement.md). Events carry page paths and short labels only — never emails, names, objective
// text or anything typed by the visitor. Turning a provider on is also a privacy-policy change.

export type AnalyticsEvent =
  | "cta_click" // a get-started / start link was clicked {from, to}
  | "blog_cta_click" // the call to action under an article {slug, cta}
  | "blog_related_click" // a related article {slug, to}
  | "access_request_click" // the request-access email was opened {from}
  | "signup_completed" // an account was created {invite: "yes"|"no"}
  | "trial_started"; // a no-account trial began

type Props = Record<string, string | number | boolean | null>;

export const ANALYTICS_PROVIDER = (process.env.NEXT_PUBLIC_ANALYTICS || "").trim().toLowerCase();
export const analyticsEnabled = ANALYTICS_PROVIDER === "vercel";

declare global {
  interface Window {
    va?: (event: "event", payload: { name: string; data?: Props }) => void;
    vaq?: unknown[];
  }
}

export function track(name: AnalyticsEvent, props: Props = {}): void {
  if (!analyticsEnabled || typeof window === "undefined") return;
  try {
    // Vercel Web Analytics queues calls made before its script has loaded (window.vaq).
    window.va ??= (...args: unknown[]) => {
      (window.vaq ??= []).push(args);
    };
    window.va("event", { name, data: props });
  } catch {
    /* analytics must never break a page */
  }
}
