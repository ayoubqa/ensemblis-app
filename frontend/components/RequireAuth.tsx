"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { getToken, type AccountType } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { loginUrl, ROUTES } from "@/lib/routes";
import { EmptyState, PageSkeleton } from "./UI";

/**
 * Wrap private pages. While the session loads it shows a skeleton; signed-out
 * visitors are redirected to /login?next=<current url>. Pass `accountType` to
 * restrict a page to companies or developers.
 *
 *   export default function Page() {
 *     return <RequireAuth><Dashboard /></RequireAuth>;
 *   }
 */
export function RequireAuth({ children, accountType, fallback }: { children: ReactNode; accountType?: AccountType; fallback?: ReactNode }) {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  // A stored token with no user means /me failed for a non-auth reason (the
  // server is unreachable): keep the session and offer a retry, don't log out.
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
          You're still signed in. Check your connection, then try again.
        </EmptyState>
      </div>
    );
  }
  if (loading || !user) return <>{fallback ?? <PageSkeleton />}</>;

  if (accountType && user.accountType !== accountType) {
    const dev = accountType === "DEVELOPER";
    return (
      <div className="narrow" style={{ padding: "56px 24px" }}>
        <EmptyState
          icon={dev ? "code" : "home"}
          title={dev ? "This page is for agent developers" : "This page is for teams hiring agents"}
          action={{ label: dev ? "Back to your dashboard" : "Go to developer dashboard", href: dev ? ROUTES.dashboard : ROUTES.devDashboard }}
        >
          {dev ? "Your account is set up to hire AI agents. Developer tools live under Developers." : "Your account is set up as a developer account."}
        </EmptyState>
      </div>
    );
  }
  return <>{children}</>;
}

export default RequireAuth;
