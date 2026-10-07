"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, type LegacyTask, type Objective, type ObjectiveCounts, type ObjectiveGroup } from "@/lib/api";
import { EmptyState, Icon, OutcomeTag, PageHead, RequireAuth, SkeletonText, StatusTag, Tabs, VerificationTag } from "@/components";
import { eur, relativeTime, shortDate } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";

export default function ObjectivesPage() {
  return (
    <RequireAuth>
      <Suspense>
        <Objectives />
      </Suspense>
    </RequireAuth>
  );
}

type Tab = ObjectiveGroup | "earlier";

function Objectives() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params.get("group") as Tab) || "all";
  const [tab, setTab] = useState<Tab>(initial);
  const [q, setQ] = useState("");
  const query = useDebounced(q, 250);
  const [rows, setRows] = useState<Objective[] | null>(null);
  const [counts, setCounts] = useState<ObjectiveCounts | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<LegacyTask[] | null>(null);
  const [legacyCursor, setLegacyCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    if (tab === "earlier") {
      const r = await api.listLegacyReports();
      setLegacy(r.tasks);
      setLegacyCursor(r.nextCursor);
      return;
    }
    const r = await api.listObjectives({ group: tab, q: query || undefined });
    setRows(r.objectives);
    setCounts(r.counts);
    setCursor(r.nextCursor);
  }, [tab, query]);

  useEffect(() => {
    setRows(null);
    load().catch(() => setRows([]));
  }, [load]);

  // Keep in-progress objectives fresh without hammering the API.
  useEffect(() => {
    if (tab === "earlier" || !rows?.some((o) => ["PLANNING", "RUNNING", "VERIFYING"].includes(o.status))) return;
    const t = setInterval(() => void load().catch(() => undefined), 10_000);
    return () => clearInterval(t);
  }, [rows, tab, load]);

  useEffect(() => {
    if (tab === "earlier" && legacy === null) load().catch(() => setLegacy([]));
  }, [tab, legacy, load]);

  const more = async () => {
    setLoadingMore(true);
    try {
      if (tab === "earlier" && legacyCursor) {
        const r = await api.listLegacyReports(legacyCursor);
        setLegacy((x) => [...(x ?? []), ...r.tasks]);
        setLegacyCursor(r.nextCursor);
      } else if (cursor) {
        const r = await api.listObjectives({ group: tab as ObjectiveGroup, cursor, q: query || undefined });
        setRows((x) => [...(x ?? []), ...r.objectives]);
        setCursor(r.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const tabs = [
    { id: "all", label: "All", count: counts?.all },
    { id: "active", label: "In progress", count: counts?.active },
    { id: "attention", label: "Needs attention", count: counts?.attention },
    { id: "completed", label: "Completed", count: counts?.completed },
    { id: "drafts", label: "Drafts", count: counts?.drafts },
    { id: "closed", label: "Failed & cancelled", count: counts?.closed },
    { id: "earlier", label: "Earlier reports" },
  ];

  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <PageHead
        eyebrow="OBJECTIVES"
        title="Objectives"
        sub="Every business outcome you have delegated: its plan, execution, verification and measured result."
        actions={
          <>
            <Link href={ROUTES.routines} className="btn">
              <Icon name="redo" />
              Recurring
            </Link>
            <Link href={ROUTES.newObjective} className="btn p">
              <Icon name="plus" />
              Define an outcome
            </Link>
          </>
        }
      />
      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(id) => {
          setTab(id as Tab);
          router.replace(id === "all" ? ROUTES.objectives : `${ROUTES.objectives}?group=${id}`);
        }}
        label="Filter objectives"
      />
      {tab !== "earlier" && (
        <input className="f" style={{ maxWidth: 360, marginBottom: 14 }} placeholder="Search objectives" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search objectives" />
      )}

      {tab === "earlier" ? (
        legacy === null ? (
          <div className="card">
            <SkeletonText lines={4} />
          </div>
        ) : legacy.length === 0 ? (
          <EmptyState icon="file" title="No earlier reports">
            Reports produced before objectives existed would appear here.
          </EmptyState>
        ) : (
          <div className="olist">
            {legacy.map((t) => (
              <Link key={t.id} href={ROUTES.legacyReport(t.id)} className="orow" style={{ gridTemplateColumns: "minmax(0,1fr) 140px 100px" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{t.title}</div>
                  <div className="s">Earlier report · {t.createdBy.name}</div>
                </div>
                <span className="small muted hideM">{t.status === "COMPLETED" ? "Completed" : t.status.toLowerCase()}</span>
                <span className="small muted">{shortDate(t.completedAt ?? t.createdAt)}</span>
              </Link>
            ))}
          </div>
        )
      ) : rows === null ? (
        <div className="card">
          <SkeletonText lines={5} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="flag" title={tab === "all" ? "No objectives yet" : "Nothing here"} action={tab === "all" ? { label: "Define your first outcome", href: ROUTES.newObjective, icon: "plus" } : undefined}>
          {tab === "all"
            ? "Describe a business result you need. The Chief of Staff plans it, your AI Team executes it, and you get a verified, evidenced outcome."
            : "No objectives match this filter."}
        </EmptyState>
      ) : (
        <div className="olist" data-testid="objective-list">
          {rows.map((o) => {
            const ex = o.latestExecution;
            const pct = ex && ex.progress.total ? Math.round((ex.progress.done / ex.progress.total) * 100) : 0;
            return (
              <Link key={o.id} href={ROUTES.objective(o.id)} className="orow">
                <div style={{ minWidth: 0 }}>
                  <div className="t">{o.title}</div>
                  <div className="s">
                    {ex?.currentStep
                      ? `${ex.currentStep.agent} (${ex.currentStep.executiveTitle}): ${ex.currentStep.title}`
                      : ex?.outcomeSummary ?? `${o.criteria.length} success criteri${o.criteria.length === 1 ? "on" : "a"} · budget ${eur(o.budgetCents)}`}
                  </div>
                  {ex && ["RUNNING", "VERIFYING"].includes(ex.status) && (
                    <div className="bar" aria-hidden="true">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                <div className="row wrapflex" style={{ gap: 6 }}>
                  <StatusTag status={o.status} />
                </div>
                <div className="row wrapflex hideM" style={{ gap: 6 }}>
                  {o.outcomeStatus ? <OutcomeTag outcome={o.outcomeStatus} /> : ex?.verificationStatus ? <VerificationTag status={ex.verificationStatus} /> : <span className="tiny muted">—</span>}
                </div>
                <span className="small muted hideM" style={{ textAlign: "right" }}>
                  {relativeTime(o.updatedAt)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {((tab === "earlier" && legacyCursor) || (tab !== "earlier" && cursor)) && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button type="button" className="btn" onClick={more} aria-busy={loadingMore} disabled={loadingMore}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
