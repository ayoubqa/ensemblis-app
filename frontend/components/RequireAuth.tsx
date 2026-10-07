"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { loginUrl } from "@/lib/routes";
import { EmptyState, PageSkeleton } from "./UI";

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
    if (!loading && !user && !getToken()) {
      const here = window.location.pathname + window.location.search + window.location.hash;
      router.replace(loginUrl(here));
    }
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
