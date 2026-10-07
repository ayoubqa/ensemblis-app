"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ExceptionItem } from "@/lib/api";
import { EmptyState, PageHead, RequireAuth, SkeletonText, Tabs } from "@/components";
import { ExceptionCard } from "@/components/ops";

export default function ExceptionsPage() {
  return (
    <RequireAuth>
      <ExceptionCenter />
    </RequireAuth>
  );
}

function ExceptionCenter() {
  const [tab, setTab] = useState<"OPEN" | "ALL">("OPEN");
  const [rows, setRows] = useState<ExceptionItem[] | null>(null);
  const load = useCallback(async () => setRows((await api.listExceptions(tab)).exceptions), [tab]);
  useEffect(() => {
    setRows(null);
    load().catch(() => setRows([]));
  }, [load]);
  return (
    <div className="narrow" style={{ maxWidth: 900, paddingBottom: 48 }}>
      <PageHead
        eyebrow="CONTROL"
        title="Exceptions"
        sub="Routine work is handled automatically. When Ensemblis can't safely proceed, it stops and tells you what happened, why it matters, what it recommends and what it needs from you."
      />
      <Tabs tabs={[{ id: "OPEN", label: "Open", count: tab === "OPEN" ? rows?.length : undefined }, { id: "ALL", label: "History" }]} value={tab} onChange={(t) => setTab(t as "OPEN" | "ALL")} label="Exceptions" />
      {rows === null ? (
        <div className="card">
          <SkeletonText lines={4} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="shield" title={tab === "OPEN" ? "No open exceptions" : "No exceptions yet"}>
          Missing information, failed steps, failed verification or a blocked start would appear here — and the execution waits for you.
        </EmptyState>
      ) : (
        <div className="stack">
          {rows.map((x) => (
            <ExceptionCard key={x.id} exception={x} onDone={load} showObjective />
          ))}
        </div>
      )}
    </div>
  );
}
