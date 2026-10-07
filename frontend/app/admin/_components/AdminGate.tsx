"use client";

import { useState } from "react";
import { Icon, PageSkeleton } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { AdminView } from "./AdminView";
import { OwnerDashboard } from "./OwnerDashboard";

/**
 * /admin: owners (user.isAdmin — emails in the server's ADMIN_EMAILS) get the
 * real owner dashboard; everyone else gets the illustrative demo console.
 */
export function AdminGate() {
  const { user, loading } = useAuth();
  const [previewDemo, setPreviewDemo] = useState(false);

  if (loading) return <PageSkeleton cards={4} />;
  if (!user?.isAdmin) return <AdminView />;

  if (previewDemo)
    return (
      <>
        <div className="wrap" style={{ paddingTop: 16 }}>
          <div className="notice" role="status" style={{ background: "var(--accent-soft)", color: "var(--accent)", alignItems: "center" }}>
            <Icon name="info" />
            <span className="sp">You&apos;re previewing the demo console that visitors who aren&apos;t owners see. Nothing here is real data.</span>
            <button type="button" className="btn sm" onClick={() => setPreviewDemo(false)}>
              <Icon name="back" />
              Back to owner dashboard
            </button>
          </div>
        </div>
        <AdminView />
      </>
    );

  return <OwnerDashboard onPreviewDemo={() => setPreviewDemo(true)} />;
}
