"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { ROUTES } from "@/lib/routes";
import { Icon } from "./Icon";

const DISMISS_KEY = "ensemblis_guest_banner_dismissed";

/** Pages where the banner would only repeat what the page already says. */
const HIDE_ON = [ROUTES.signup, ROUTES.login, ROUTES.forgotPassword, ROUTES.resetPassword];

/** "/signup?claim=1&next=/objectives/abc" — the claim form sends the guest back to where they were. */
export function claimUrl(next?: string | null): string {
  const q = new URLSearchParams({ claim: "1" });
  if (next && next.startsWith("/") && !next.startsWith("//") && next !== "/") q.set("next", next);
  return `${ROUTES.signup}?${q.toString()}`;
}

/**
 * Slim sticky notice for guest-trial accounts, pinned just under the header
 * (its offset follows the header's real height via --sh-header-h):
 * "save your work by creating a free account". Dismissible for the browser session.
 */
export function GuestBanner() {
  const { user } = useAuth();
  const pathname = usePathname() || "/";
  const [dismissed, setDismissed] = useState(true); // assume hidden until storage is read (no flash)
  const [tucked, setTucked] = useState(false);
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
    <div className={tucked ? "sh-guest tucked no-print" : "sh-guest no-print"} role="region" aria-label="Free trial">
      <div className="wrap sh-guest-in">
        <span className="sh-guest-ico" aria-hidden="true">
          <Icon name="userPlus" />
        </span>
        <p className="sh-guest-txt">
          <span className="sh-lg">
            <b>You&apos;re on a free trial.</b> Save your work by creating a free account.
          </span>
          <span className="sh-sm">
            <b>Free trial</b> — save your work.
          </span>
          <span className="sh-guest-sub">Your trial objectives and their outcomes come with you. Trial work that isn&apos;t saved to an account is deleted automatically.</span>
        </p>
        <Link className="btn p sm" href={claimUrl(pathname)}>
          <span className="sh-lg">Create free account</span>
          <span className="sh-sm">Save</span>
          <span className="sr-only"> — keep your trial work</span>
          <Icon name="arrow" size={14} />
        </Link>
        <button type="button" className="sh-x" onClick={dismiss} aria-label="Dismiss free trial notice">
          <Icon name="x" size={15} />
        </button>
      </div>
    </div>
  );
}

export default GuestBanner;
