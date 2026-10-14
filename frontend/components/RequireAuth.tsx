"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { loginUrl } from "@/lib/routes";
import { EmptyState, PageSkeleton } from "./UI";

// A sign-out that navigates somewhere itself (the account menu, the command palette) marks
// itself here first. Otherwise the private page being left reacts to the cleared session
// with its own /login?next=<this page> redirect, which wins over that navigation — and the
// next person to log in on this browser would land on the previous user's page.
const LEAVING_MS = 3000;
let leavingUntil = 0;

/** Call right before `signOut()` when you navigate away yourself (e.g. to the home page). */
export function leavingAfterSignOut() {
  leavingUntil = Date.now() + LEAVING_MS;
}

/**
 * Wrap private pages. While the session loads it shows a skeleton; signed-out
 * visitors (or a session that just ended with a 401) are redirected to
 * /login?next=<current url>.
 */
export function RequireAuth({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  // A stored token with no user means /me failed for a non-auth reason (server unreachable): keep the session, offer a retry.
  const offline = !loading && !user && !!getToken();

  useEffect(() => {
    if (loading || user || getToken()) return;
    const toLogin = () => router.replace(loginUrl(window.location.pathname + window.location.search + window.location.hash));
    const wait = leavingUntil - Date.now();
    if (wait <= 0) {
      toLogin();
      return;
    }
    // A sign-out is already navigating away; this page unmounts when it lands. If it never
    // does, fall back to the usual login redirect.
    const t = window.setTimeout(toLogin, wait);
    return () => window.clearTimeout(t);
  }, [loading, user, router]);

  if (offline) {
    return (
      <div className="narrow" style={{ padding: "56px 24px" }}>
        <EmptyState icon="alert" title="Can't reach the Ensemblis server" action={{ label: "Try again", onClick: () => void refresh() }}>
          You&apos;re still signed in. Check your connection, then try again.
        </EmptyState>
      </div>
    );
  }
  if (loading || !user) return <>{fallback ?? <PageSkeleton />}</>;
  return <>{children}</>;
}

export default RequireAuth;
