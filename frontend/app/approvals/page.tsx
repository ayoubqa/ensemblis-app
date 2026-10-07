"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Approval } from "@/lib/api";
import { EmptyState, PageHead, RequireAuth, SkeletonText, Tabs } from "@/components";
import { ApprovalCard } from "@/components/ops";
import { ROUTES } from "@/lib/routes";

export default function ApprovalsPage() {
  return (
    <RequireAuth>
      <ApprovalCenter />
    </RequireAuth>
  );
}

function ApprovalCenter() {
  const [tab, setTab] = useState<"PENDING" | "ALL">("PENDING");
  const [rows, setRows] = useState<Approval[] | null>(null);
  const load = useCallback(async () => setRows((await api.listApprovals(tab)).approvals), [tab]);
  useEffect(() => {
    setRows(null);
    load().catch(() => setRows([]));
  }, [load]);
  return (
    <div className="narrow" style={{ maxWidth: 900, paddingBottom: 48 }}>
      <PageHead eyebrow="CONTROL" title="Approvals" sub="Plans and spending that need a person's authorization before the AI Team acts. Nothing is charged until you approve." />
      <Tabs tabs={[{ id: "PENDING", label: "Pending", count: tab === "PENDING" ? rows?.length : undefined }, { id: "ALL", label: "History" }]} value={tab} onChange={(t) => setTab(t as "PENDING" | "ALL")} label="Approvals" />
      {rows === null ? (
        <div className="card">
          <SkeletonText lines={4} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="check" title={tab === "PENDING" ? "Nothing waiting for approval" : "No approvals yet"} action={tab === "PENDING" ? { label: "Define an outcome", href: ROUTES.newObjective } : undefined}>
          When the Chief of Staff plans an objective that needs your sign-off, it appears here with its cost, risk and a recommendation.
        </EmptyState>
      ) : (
        <div className="stack">
          {rows.map((a) => (
            <ApprovalCard key={a.id} approval={a} onDone={load} showObjective />
          ))}
        </div>
      )}
    </div>
  );
}
