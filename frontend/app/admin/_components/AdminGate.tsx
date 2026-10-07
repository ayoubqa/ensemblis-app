"use client";

import Link from "next/link";
import { EmptyState, PageSkeleton } from "@/components";
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
      <div className="narrow" style={{ padding: "56px 0" }}>
        <EmptyState icon="lock" title="Operations console">
          This page is for the people who operate this deployment.{" "}
          {user && !user.emailVerified ? (
            <>
              Operators must have a verified email — <Link href={`${ROUTES.settings}#profile`}>verify yours in Settings</Link>.
            </>
          ) : (
            <Link href={ROUTES.dashboard}>Back to your briefing</Link>
          )}
        </EmptyState>
      </div>
    );
  return <OwnerDashboard />;
}
