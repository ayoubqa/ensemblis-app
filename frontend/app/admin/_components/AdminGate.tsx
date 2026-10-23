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
          <p>
            This page is for the people who operate this Ensemblis deployment.{" "}
            {user && !user.emailVerified ? (
              <>
                Operators must have a verified email — <Link href={`${ROUTES.settings}#profile`}>verify yours in Settings</Link>.
              </>
            ) : (
              <Link href={ROUTES.dashboard}>Back to Home</Link>
            )}
          </p>
        </div>
      </div>
    );
  return <OwnerDashboard />;
}
