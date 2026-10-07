"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useMediaQuery } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { Icon } from "./Icon";

const DISMISS_KEY = "ensemblis_guest_banner_dismissed";

/** Pages where the banner would only repeat what the page already says. */
const HIDE_ON = [ROUTES.signup, ROUTES.login, ROUTES.forgotPassword, ROUTES.resetPassword];

/** "/signup?claim=1&next=/tasks/abc" — the claim form sends the guest back to where they were. */
export function claimUrl(next?: string | null): string {
  const q = new URLSearchParams({ claim: "1" });
  if (next && next.startsWith("/") && !next.startsWith("//") && next !== "/") q.set("next", next);
  return `${ROUTES.signup}?${q.toString()}`;
}

/**
 * Slim sticky notice for guest-trial accounts, pinned just under the header:
 * "save your work by creating a free account". Dismissible for the browser session.
 */
export function GuestBanner() {
  const { user } = useAuth();
  const pathname = usePathname() || "/";
  const [dismissed, setDismissed] = useState(true); // assume hidden until storage is read (no flash)
  const [tucked, setTucked] = useState(false);
  const phone = useMediaQuery("(max-width: 560px)");
  const hiddenHere = HIDE_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const visible = !!user?.isGuest && !dismissed && !hiddenHere;

  useEffect(() => {
    let off = false;
    try {
      off = sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* storage unavailable */
    }
    setDismissed(off);
  }, []);

  // Stays sticky, but tucks under the header while scrolling down (so it never sits on top of
  // sticky sidebars like the report contents) and comes back on scroll-up or near the top.
  useEffect(() => {
    if (!visible) return;
    setTucked(false);
    let lastY = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        if (y < 160) setTucked(false);
        else if (y > lastY + 8) setTucked(true);
        else if (y < lastY - 8) setTucked(false);
        lastY = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [visible, pathname]);

  if (!visible) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* dismissed until reload */
    }
    document.getElementById("main")?.focus({ preventScroll: true });
  };

  return (
    <div
      className="no-print"
      role="region"
      aria-label="Free trial"
      style={{
        position: "sticky",
        top: "calc(env(safe-area-inset-top, 0px) + 61px)", // directly under the sticky 60px header (+1px border)
        zIndex: 39,
        background: "linear-gradient(90deg, var(--accent-soft), color-mix(in srgb, var(--cyan) 14%, var(--surface)))",
        borderBottom: "1px solid var(--line)",
        color: "var(--ink)",
        transform: tucked ? "translateY(-100%)" : "none",
        visibility: tucked ? "hidden" : "visible",
        transition: "transform .25s ease, visibility .25s",
      }}
    >
      <div className="wrap row" style={{ gap: 10, paddingTop: 7, paddingBottom: 7, minHeight: 46 }}>
        <span
          aria-hidden="true"
          style={{
            flex: "none",
            width: 26,
            height: 26,
            borderRadius: 8,
            display: "grid",
            placeItems: "center",
            background: "var(--surface)",
            color: "var(--accent)",
            boxShadow: "inset 0 0 0 1px var(--line)",
          }}
        >
          <Icon name="spark" size={15} />
        </span>
        <p className="small" style={{ margin: 0, flex: 1, minWidth: 0, lineHeight: 1.35 }}>
          {phone ? (
            <>
              <b>Free trial</b> — save your work with a free account.
            </>
          ) : (
            <>
              <b>You&apos;re on a free trial</b> — save your work by creating a free account.
              <span className="tiny muted" style={{ display: "block" }}>
                Your task and report come with you. Unsaved trial results are deleted after 7 days.
              </span>
            </>
          )}
        </p>
        <Link className="btn p sm" href={claimUrl(pathname)} style={{ flex: "none" }}>
          {phone ? "Save" : "Create free account"}
          <span className="sr-only"> — save your trial results</span>
          <Icon name="arrow" size={14} />
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss free trial notice"
          style={{
            flex: "none",
            display: "inline-grid",
            placeItems: "center",
            width: 32,
            height: 32,
            border: 0,
            borderRadius: 8,
            background: "none",
            color: "var(--muted)",
            cursor: "pointer",
          }}
        >
          <Icon name="x" size={15} />
        </button>
      </div>
    </div>
  );
}

export default GuestBanner;
