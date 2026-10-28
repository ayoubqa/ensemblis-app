import Script from "next/script";
import { analyticsEnabled } from "@/lib/analytics";

/**
 * Loads the analytics provider — only when NEXT_PUBLIC_ANALYTICS=vercel was set at build time. Otherwise it
 * renders nothing and nothing is collected. Vercel Web Analytics is cookie-less and first-party
 * (/_vercel/insights); it must be enabled in the Vercel project before this script does anything.
 * See docs/growth/04-measurement.md.
 */
export function SiteAnalytics() {
  if (!analyticsEnabled) return null;
  return (
    <>
      <Script id="va-queue" strategy="afterInteractive">{`window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };`}</Script>
      <Script src="/_vercel/insights/script.js" strategy="afterInteractive" />
    </>
  );
}
