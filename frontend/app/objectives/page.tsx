"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, type LegacyTask, type Objective, type ObjectiveCounts, type ObjectiveGroup, type ObjectiveStatus } from "@/lib/api";
import { EmptyState, Icon, OutcomeTag, PageHead, ProgressBar, RequireAuth, Skeleton, StatusTag, Tabs, VerificationTag, useToast, type IconName } from "@/components";
import { eur, plural, relativeTime, shortDate } from "@/lib/format";
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
const TABS: Tab[] = ["all", "active", "attention", "completed", "drafts", "closed", "earlier"];
const PAGE = 30;

/** How the "All" view is grouped: what needs you first, then live work, then the record. */
const GROUPS: { id: string; label: string; statuses: ObjectiveStatus[] }[] = [
  { id: "attention", label: "Needs you", statuses: ["WAITING_FOR_APPROVAL", "BLOCKED"] },
  { id: "active", label: "In progress", statuses: ["PLANNING", "PLANNED", "RUNNING", "VERIFYING"] },
  { id: "drafts", label: "Drafts", statuses: ["DRAFT"] },
  { id: "completed", label: "Completed", statuses: ["COMPLETED"] },
  { id: "closed", label: "Failed & cancelled", statuses: ["FAILED", "CANCELLED"] },
];

const EMPTY: Record<Exclude<Tab, "all" | "earlier">, { icon: IconName; title: string; body: string }> = {
  active: { icon: "layers", title: "Nothing in progress", body: "Objectives being planned, executed or verified appear here." },
  attention: { icon: "check", title: "Nothing needs you", body: "No plan is waiting for approval and no execution is blocked." },
  completed: { icon: "flag", title: "No completed objectives yet", body: "Delivered outcomes appear here with their verification and evidence." },
  drafts: { icon: "edit", title: "No drafts", body: "Objectives you save as a draft wait here until you send them to the Chief of Staff." },
  closed: { icon: "x", title: "Nothing failed or cancelled", body: "Objectives that failed or that you cancelled would appear here." },
};

const LEGACY_STATUS: Record<LegacyTask["status"], string> = { PLANNING: "Planning", RUNNING: "In progress", COMPLETED: "Completed", FAILED: "Failed", REFUNDED: "Refunded" };

const isLive = (o: Objective) => ["PLANNING", "RUNNING", "VERIFYING"].includes(o.status);

function Objectives() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const requested = params.get("group") as Tab | null;
  const [tab, setTab] = useState<Tab>(requested && TABS.includes(requested) ? requested : "all");
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 250);
  const [rows, setRows] = useState<Objective[] | null>(null);
  const [counts, setCounts] = useState<ObjectiveCounts | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<LegacyTask[] | null>(null);
  const [legacyCursor, setLegacyCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  // Only the newest request may update the list (fast tab / search changes).
  const seq = useRef(0);

  const load = useCallback(
    async (limit?: number) => {
      const n = ++seq.current;
      if (tab === "earlier") {
        const r = await api.listLegacyReports();
        if (n !== seq.current) return;
        setLegacy(r.tasks);
        setLegacyCursor(r.nextCursor);
        return;
      }
      const r = await api.listObjectives({ group: tab, q: query || undefined, limit });
      if (n !== seq.current) return;
      setRows(r.objectives);
      setCounts(r.counts);
      setCursor(r.nextCursor);
    },
    [tab, query]
  );

  const reload = useCallback(() => {
    setRows(null);
    setFailed(false);
    load().catch(() => setFailed(true));
  }, [load]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Keep in-progress objectives fresh without hammering the API (and without dropping pages loaded with "Load more").
  const loaded = rows?.length ?? 0;
  const live = tab !== "earlier" && !!rows?.some(isLive);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(Math.min(100, Math.max(PAGE, loaded))).catch(() => undefined), 10_000);
    return () => clearInterval(t);
  }, [live, loaded, load]);

  const more = async () => {
    setLoadingMore(true);
    const n = seq.current;
    try {
      if (tab === "earlier" && legacyCursor) {
        const r = await api.listLegacyReports(legacyCursor);
        if (n !== seq.current) return;
        setLegacy((x) => [...(x ?? []), ...r.tasks]);
        setLegacyCursor(r.nextCursor);
      } else if (tab !== "earlier" && cursor) {
        const r = await api.listObjectives({ group: tab, cursor, q: query || undefined });
        if (n !== seq.current) return;
        setRows((x) => [...(x ?? []), ...r.objectives]);
        setCursor(r.nextCursor);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const tabs = [
    { id: "all", label: "All", count: counts?.all },
    { id: "attention", label: "Needs you", count: counts?.attention },
    { id: "active", label: "In progress", count: counts?.active },
    { id: "completed", label: "Completed", count: counts?.completed },
    { id: "drafts", label: "Drafts", count: counts?.drafts },
    { id: "closed", label: "Failed & cancelled", count: counts?.closed },
    { id: "earlier", label: "Earlier reports" },
  ];

  const grouped = tab === "all" && !query && rows ? GROUPS.map((g) => ({ ...g, rows: rows.filter((o) => g.statuses.includes(o.status)) })).filter((g) => g.rows.length) : null;

  return (
    <div className="wrap ws-page ws-objs">
      <PageHead
        eyebrow="Objectives"
        title="Objectives"
        sub="Every business outcome you have delegated, with its plan, execution, verification and measured result."
        actions={
          <>
            <Link href={ROUTES.routines} className="btn">
              <Icon name="redo" />
              Recurring objectives
            </Link>
            <Link href={ROUTES.newObjective} className="btn p">
              <Icon name="plus" />
              Define an outcome
            </Link>
          </>
        }
      />

      <div className="ws-objs-tabs">
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(id) => {
            setTab(id as Tab);
            router.replace(id === "all" ? ROUTES.objectives : `${ROUTES.objectives}?group=${id}`);
          }}
          label="Filter objectives"
        />
      </div>

      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="ws-objs-panel">
        {tab !== "earlier" && (
          <div className="ws-toolbar">
            <div className="ws-search">
              <Icon name="search" size={16} />
              <input className="f" type="search" placeholder="Search objectives" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search objectives" />
            </div>
            <p className="ws-meta" aria-live="polite">
              {rows && query ? `${plural(rows.length, "result")}${cursor ? "+" : ""} for “${query}”` : rows && rows.length ? plural(rows.length, "objective") + (cursor ? " shown" : "") : ""}
            </p>
          </div>
        )}

        {failed ? (
          <EmptyState icon="alert" title={tab === "earlier" ? "Earlier reports couldn't be loaded" : "Objectives couldn't be loaded"} action={{ label: "Try again", onClick: reload, icon: "redo" }}>
            Something went wrong on our side. Nothing was changed.
          </EmptyState>
        ) : tab === "earlier" ? (
          legacy === null ? (
            <ListSkeleton />
          ) : legacy.length === 0 ? (
            <EmptyState icon="file" title="No earlier reports">
              Reports produced before objectives existed would appear here.
            </EmptyState>
          ) : (
            <ul className="ws-panel ws-ol ws-ol-legacy">
              {legacy.map((t) => (
                <li key={t.id}>
                  <Link href={ROUTES.legacyReport(t.id)} className="ws-or">
                    <span className="ws-or-main">
                      <span className="ws-or-t">{t.title}</span>
                      <span className="ws-or-s">Earlier report · {t.createdBy.name}</span>
                    </span>
                    <span className="ws-or-status">
                      <span className={t.status === "COMPLETED" ? "tag ok" : "tag gray"}>{LEGACY_STATUS[t.status] ?? t.status}</span>
                    </span>
                    <span className="ws-or-time">{shortDate(t.completedAt ?? t.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : rows === null ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          query ? (
            <EmptyState icon="search" title={`No objectives match “${query}”`} action={{ label: "Clear search", onClick: () => setQ("") }}>
              Try another word from the objective&apos;s title or statement.
            </EmptyState>
          ) : tab === "all" ? (
            <EmptyState icon="flag" title="No objectives yet" action={{ label: "Define your first outcome", href: ROUTES.newObjective, icon: "plus" }}>
              Describe a business result you need. The Chief of Staff plans it, your AI Team executes it, and you get a verified, evidenced outcome.
            </EmptyState>
          ) : (
            <EmptyState icon={EMPTY[tab].icon} title={EMPTY[tab].title}>
              {EMPTY[tab].body}
            </EmptyState>
          )
        ) : (
          <div className="ws-panel ws-ol" data-testid="objective-list">
            <div className="ws-ol-head" aria-hidden="true">
              <span>Objective</span>
              <span>Status</span>
              <span>Outcome &amp; verification</span>
              <span>Updated</span>
            </div>
            {grouped ? (
              grouped.map((g) => (
                <Fragment key={g.id}>
                  <h2 className="ws-ol-group">
                    {g.label}
                    <span className="ws-count">{g.rows.length}</span>
                  </h2>
                  <ul>
                    {g.rows.map((o) => (
                      <ObjectiveRow key={o.id} o={o} />
                    ))}
                  </ul>
                </Fragment>
              ))
            ) : (
              <ul>
                {rows.map((o) => (
                  <ObjectiveRow key={o.id} o={o} />
                ))}
              </ul>
            )}
          </div>
        )}

        {!failed && ((tab === "earlier" && legacyCursor) || (tab !== "earlier" && cursor)) && (
          <div className="ws-more">
            <button type="button" className="btn" onClick={more} aria-busy={loadingMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ObjectiveRow({ o }: { o: Objective }) {
  const ex = o.latestExecution;
  const pct = ex && ex.progress.total ? Math.round((ex.progress.done / ex.progress.total) * 100) : 0;
  const working = !!ex && ["RUNNING", "VERIFYING"].includes(ex.status);
  const sub = ex?.currentStep
    ? `${ex.currentStep.agent} (${ex.currentStep.executiveTitle}): ${ex.currentStep.title}`
    : ex?.outcomeSummary ?? `${o.criteria.length} success criteri${o.criteria.length === 1 ? "on" : "a"} · budget ${eur(o.budgetCents)}`;
  const hasResult = !!o.outcomeStatus || !!ex?.verificationStatus;
  return (
    <li>
      <Link href={ROUTES.objective(o.id)} className="ws-or">
        <span className="ws-or-main">
          <span className="ws-or-t">{o.title}</span>
          <span className="ws-or-s">{sub}</span>
          {working && <ProgressBar value={pct} label={`Execution progress: ${ex!.progress.done} of ${ex!.progress.total} steps`} style={{ marginTop: 8, maxWidth: 360 }} />}
        </span>
        <span className="ws-or-status">
          <StatusTag status={o.status} />
        </span>
        <span className="ws-or-result">
          {hasResult ? (
            <>
              <OutcomeTag outcome={o.outcomeStatus} />
              <VerificationTag status={ex?.verificationStatus} score={ex?.verificationScore} />
            </>
          ) : (
            <span className="ws-dash">
              <span aria-hidden="true">—</span>
              <span className="sr-only">No result yet</span>
            </span>
          )}
        </span>
        <span className="ws-or-time">{relativeTime(o.updatedAt)}</span>
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="ws-panel ws-ol" aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3].map((i) => (
        <div className="ws-or ws-or-sk" key={i}>
          <span className="ws-or-main">
            <Skeleton height={13} width={`${70 - i * 8}%`} />
            <Skeleton height={10} width="40%" style={{ marginTop: 10 }} />
          </span>
          <Skeleton height={20} width={90} radius={999} />
        </div>
      ))}
    </div>
  );
}
