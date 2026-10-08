"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type LegacyTask, type Objective } from "@/lib/api";
import { EmptyState, Icon, OutcomeTag, PageHead, RequireAuth, Skeleton, VerificationTag, useToast } from "@/components";
import { eur, plural, shortDate } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

export default function ReportsPage() {
  return (
    <RequireAuth>
      <Reports />
    </RequireAuth>
  );
}

const LEGACY_STATUS: Record<LegacyTask["status"], string> = { PLANNING: "Planning", RUNNING: "In progress", COMPLETED: "Completed", FAILED: "Failed", REFUNDED: "Refunded" };

/** Verified deliverables: completed objectives (with outcome + verification) and the earlier reports from before objectives existed. */
function Reports() {
  const toast = useToast();
  const [done, setDone] = useState<Objective[] | null>(null);
  const [doneTotal, setDoneTotal] = useState<number | null>(null);
  const [doneCursor, setDoneCursor] = useState<string | null>(null);
  const [doneFailed, setDoneFailed] = useState(false);
  const [legacy, setLegacy] = useState<LegacyTask[] | null>(null);
  const [legacyCursor, setLegacyCursor] = useState<string | null>(null);
  const [legacyFailed, setLegacyFailed] = useState(false);
  const [busy, setBusy] = useState<"done" | "legacy" | null>(null);

  const loadDone = useCallback(() => {
    setDone(null);
    setDoneFailed(false);
    api
      .listObjectives({ group: "completed" })
      .then((r) => {
        setDone(r.objectives);
        setDoneTotal(r.counts.completed);
        setDoneCursor(r.nextCursor);
      })
      .catch(() => setDoneFailed(true));
  }, []);

  const loadLegacy = useCallback(() => {
    setLegacy(null);
    setLegacyFailed(false);
    api
      .listLegacyReports()
      .then((r) => {
        setLegacy(r.tasks);
        setLegacyCursor(r.nextCursor);
      })
      .catch(() => setLegacyFailed(true));
  }, []);

  useEffect(() => {
    loadDone();
    loadLegacy();
  }, [loadDone, loadLegacy]);

  const moreDone = async () => {
    if (!doneCursor) return;
    setBusy("done");
    try {
      const r = await api.listObjectives({ group: "completed", cursor: doneCursor });
      setDone((x) => [...(x ?? []), ...r.objectives]);
      setDoneCursor(r.nextCursor);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const moreLegacy = async () => {
    if (!legacyCursor) return;
    setBusy("legacy");
    try {
      const r = await api.listLegacyReports(legacyCursor);
      setLegacy((x) => [...(x ?? []), ...r.tasks]);
      setLegacyCursor(r.nextCursor);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="wrap ws-page ws-reports">
      <PageHead
        eyebrow="Reports"
        title="Reports"
        sub="Your verified deliverables: every completed objective with its outcome, verification and evidence — and the reports produced before objectives existed."
        actions={
          <Link href={ROUTES.objectives} className="btn">
            <Icon name="list" />
            All objectives
          </Link>
        }
      />

      <section className="ws-sec ws-sec-first" aria-labelledby="ws-rep-h">
        <div className="ws-sec-head">
          <h2 id="ws-rep-h">
            Completed outcomes
            {doneTotal !== null && doneTotal > 0 && <span className="ws-count">{doneTotal}</span>}
          </h2>
        </div>
        {doneFailed ? (
          <EmptyState icon="alert" title="Completed outcomes couldn't be loaded" action={{ label: "Try again", onClick: loadDone, icon: "redo" }}>
            Something went wrong on our side. Nothing was changed.
          </EmptyState>
        ) : done === null ? (
          <div className="ws-reps" aria-busy="true" aria-label="Loading">
            {[0, 1].map((i) => (
              <div className="ws-panel ws-rep" key={i}>
                <Skeleton height={30} width={30} radius={9} />
                <Skeleton height={14} width="80%" style={{ marginTop: 18 }} />
                <Skeleton height={11} width="50%" style={{ marginTop: 12 }} />
                <Skeleton height={20} width={160} radius={999} style={{ marginTop: 18 }} />
              </div>
            ))}
          </div>
        ) : done.length === 0 ? (
          <EmptyState icon="report" title="No reports yet" action={{ label: "Define an outcome", href: ROUTES.newObjective, icon: "plus" }}>
            When an objective is completed, its report appears here with the outcome, the verification result and the evidence behind it.
          </EmptyState>
        ) : (
          <>
            <ul className="ws-reps">
              {done.map((o) => (
                <ReportCard key={o.id} o={o} />
              ))}
            </ul>
            {doneCursor && (
              <div className="ws-more">
                <button type="button" className="btn" onClick={moreDone} aria-busy={busy === "done"} disabled={!!busy}>
                  {busy === "done" ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="ws-sec" aria-labelledby="ws-early-h">
        <div className="ws-sec-head">
          <div>
            <h2 id="ws-early-h">Earlier reports</h2>
            <p className="ws-sec-sub">Produced before objectives existed. They stay readable and shareable.</p>
          </div>
        </div>
        {legacyFailed ? (
          <EmptyState icon="alert" title="Earlier reports couldn't be loaded" action={{ label: "Try again", onClick: loadLegacy, icon: "redo" }}>
            Something went wrong on our side. Nothing was changed.
          </EmptyState>
        ) : legacy === null ? (
          <div className="ws-panel ws-quiet" aria-busy="true" aria-label="Loading">
            <Skeleton height={12} width="60%" />
          </div>
        ) : legacy.length === 0 ? (
          <div className="ws-panel ws-quiet">
            <Icon name="file" size={18} />
            <p>No earlier reports in this organization.</p>
          </div>
        ) : (
          <>
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
            {legacyCursor && (
              <div className="ws-more">
                <button type="button" className="btn" onClick={moreLegacy} aria-busy={busy === "legacy"} disabled={!!busy}>
                  {busy === "legacy" ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ReportCard({ o }: { o: Objective }) {
  const ex = o.latestExecution;
  const n = o.criteria.length;
  return (
    <li>
      <Link href={ROUTES.objective(o.id)} className="ws-panel ws-rep">
        <span className="ws-rep-top">
          <span className="ws-rep-ico" aria-hidden="true">
            <Icon name="report" size={16} />
          </span>
          <span className="ws-meta">Completed {shortDate(o.completedAt ?? ex?.completedAt ?? o.updatedAt)}</span>
        </span>
        <h3 className="ws-rep-t">{o.title}</h3>
        {ex?.outcomeSummary && <p className="ws-rep-s">{ex.outcomeSummary}</p>}
        <span className="ws-tags ws-rep-tags">
          <OutcomeTag outcome={o.outcomeStatus ?? ex?.outcomeStatus} />
          <VerificationTag status={ex?.verificationStatus} score={ex?.verificationScore} />
        </span>
        <span className="ws-rep-foot">
          <span className="ws-meta">{[ex?.outcomeSummary ? null : plural(n, "success criterion", "success criteria"), ex ? `Cost ${eur(ex.costCents, { decimals: true })}` : null].filter(Boolean).join(" · ")}</span>
          <span className="ws-rep-open">
            Open report <Icon name="arrow" size={14} />
          </span>
        </span>
      </Link>
    </li>
  );
}
