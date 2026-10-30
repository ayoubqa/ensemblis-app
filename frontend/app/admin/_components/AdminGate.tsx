"use client";

import Link from "next/link";
import { Icon, PageSkeleton } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { ROUTES } from "@/lib/routes";
import { OwnerDashboard } from "./OwnerDashboard";

/**
 * /admin: deployment operators only — a verified email listed in the server's
 * ADMIN_EMAILS (user.isAdmin). Everyone else sees a plain "not available".
 * The server enforces the same rule on /api/admin/*.
 */
export function AdminGate() {
  const { user, loading } = useAuth();
  if (loading) return <PageSkeleton cards={4} />;
  if (!user?.isAdmin)
    return (
      <div className="wrap op-page">
        <div className="op-panel op-gate">
          <span className="op-ico" aria-hidden="true">
            <Icon name="lock" />
          </span>
          <h1>Operations console</h1>
          <p>This page is for the people who operate this Ensemblis deployment.</p>
          {/* Which requirement the signed-in account misses — only ever about this account, never the operator list. */}
          {!user ? (
            <p>
              <Link href={ROUTES.login}>Sign in</Link> with an operator account.
            </p>
          ) : user.isGuest ? (
            <p>Guest trial accounts can&apos;t open it.</p>
          ) : !user.emailVerified ? (
            <p>
              You&apos;re signed in as <b>{user.email}</b>, which isn&apos;t verified yet. Operators must have a verified email —{" "}
              <Link href={`${ROUTES.settings}#profile`}>verify yours in Settings</Link>.
            </p>
          ) : (
            <p>
              You&apos;re signed in as <b>{user.email}</b> (verified), and this address isn&apos;t one of this deployment&apos;s operators.{" "}
              <Link href={ROUTES.dashboard}>Back to Home</Link>
            </p>
          )}
        </div>
      </div>
    );
  return <OwnerDashboard />;
}
