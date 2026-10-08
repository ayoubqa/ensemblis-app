"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useConfig } from "@/lib/config";
import { DEMO_CACHE_KEY, DEMO_DISMISS_KEY } from "@/lib/demo-flags";
import { ROUTES } from "@/lib/routes";
import { Icon } from "./Icon";

/**
 * Slim "public demo" notice above the header. Always in the server markup but
 * hidden by CSS unless <html data-demo="1"> (set pre-paint from a cached flag,
 * then confirmed from /api/config). Dismissal lasts for the browser session.
 */
export function DemoBanner() {
  const { config, loaded } = useConfig();

  useEffect(() => {
    if (!loaded) return;
    const r = document.documentElement;
    if (config.demoMode) r.setAttribute("data-demo", "1");
    else r.removeAttribute("data-demo");
    try {
      localStorage.setItem(DEMO_CACHE_KEY, config.demoMode ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [loaded, config.demoMode]);

  const dismiss = () => {
    document.documentElement.setAttribute("data-demo-off", "");
    try {
      sessionStorage.setItem(DEMO_DISMISS_KEY, "1");
    } catch {
      /* storage unavailable — dismissed until reload */
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  };

  return (
    <div className="dbar sh-demo dk no-print" role="region" aria-label="Demo notice">
      <div className="wrap sh-demo-in">
        <span className="sh-demo-tag">
          <Icon name="info" />
          Public demo
        </span>
        <p>
          AI output can be wrong. Don&apos;t enter confidential information. <Link href={ROUTES.terms}>Terms</Link>
        </p>
        <button type="button" className="sh-x" onClick={dismiss} aria-label="Dismiss demo notice">
          <Icon name="x" size={15} />
        </button>
      </div>
    </div>
  );
}

export default DemoBanner;
