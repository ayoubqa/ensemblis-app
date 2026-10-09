"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError, type LegacyTask } from "@/lib/api";
import { EmptyState, Icon, PageSkeleton, RequireAuth, useToast } from "@/components";
import { ExportMenu, LEGACY_NOTE, ReportView, copyText, reportTitle } from "@/components/report";
import { eur, longDate } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

const EARLIER = `${ROUTES.objectives}?group=earlier`;

export default function LegacyReportPage() {
  return (
    <RequireAuth>
      <LegacyReport />
    </RequireAuth>
  );
}

/** Read-only view of an earlier report, produced before objectives existed (v1–v3). */
function LegacyReport() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [task, setTask] = useState<LegacyTask | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { task: t } = await api.getLegacyReport(id);
      setTask(t);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!task) return;
    const before = document.title;
    document.title = `${task.title} · Earlier report · Ensemblis`;
    return () => {
      document.title = before;
    };
  }, [task]);

  if (error) {
    const missing = error instanceof ApiError && [400, 403, 404].includes(error.status);
    return (
      <div className="narrow" style={{ paddingBlock: 56 }}>
        <EmptyState
          icon="file"
          titleAs="h1"
          title={missing ? "Report not found" : "Couldn't load this report"}
          action={
            missing ? (
              { label: "Back to earlier reports", href: EARLIER }
            ) : (
              <button type="button" className="btn p" onClick={() => void load()}>
                Try again
              </button>
            )
          }
        >
          {missing ? "It may belong to another organization, or the link is incomplete." : error.message}
        </EmptyState>
      </div>
    );
  }
  if (!task) return <PageSkeleton cards={2} />;

  const latest = [...(task.revisions ?? [])].filter((r) => r.status === "COMPLETED" && r.result).sort((a, b) => b.version - a.version)[0];
  const markdown = latest?.result ?? task.result ?? "";
  const title = reportTitle(markdown) || task.title;
  const shareUrl = task.shareToken && typeof window !== "undefined" ? `${window.location.origin}${ROUTES.sharedReport(task.shareToken)}` : null;
  const done = task.status === "COMPLETED" && !!markdown.trim();

  const toggleShare = async () => {
    setBusy(true);
    try {
      const { task: t } = await api.shareLegacyReport(task.id, !task.shareToken);
      setTask((cur) => (cur ? { ...cur, shareToken: t.shareToken } : cur));
      if (t.shareToken) {
        const ok = await copyText(`${window.location.origin}${ROUTES.sharedReport(t.shareToken)}`);
        toast(ok ? "Public link created and copied" : "Public link created — open Public page to copy it");
      } else toast("Public link turned off");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap cs-legacy">
      <header className="cs-legacy-head">
        <div className="cs-crumbs">
          <Link href={EARLIER}>
            <Icon name="back" size={14} />
            Earlier reports
          </Link>
          <span aria-hidden="true">/</span>
          <span className="cs-crumb-here">Earlier report</span>
        </div>
        <h1>{title}</h1>
        <div className="cs-legacy-tags">
          <span className="tag gray">
            <Icon name="lock" />
            Read-only
          </span>
          {task.category && <span className="tag gray">{task.category}</span>}
          {latest && latest.version > 1 && <span className="tag gray">Version {latest.version}</span>}
          {task.sources.length > 0 && (
            <span className="tag gray">
              {task.sources.length} {task.sources.length === 1 ? "source" : "sources"}
            </span>
          )}
        </div>
        <p className="cs-legacy-meta">
          {task.createdBy.name} · {longDate(task.completedAt ?? task.createdAt)}
          {task.costCents > 0 && ` · ${eur(task.costCents, { decimals: true })}`}
        </p>
      </header>

      <div className="cs-legacy-note" role="note">
        <Icon name="info" size={16} />
        <span>
          This earlier report was produced before objectives existed, so it has no success criteria, approval or verification. To build on it,{" "}
          <Link href={ROUTES.newObjective} className="cs-inline-link">
            define an outcome
          </Link>
          .
        </span>
      </div>

      {!done ? (
        <EmptyState icon="alert" title="No report was produced">
          {task.errorMessage ?? "This report wasn't completed. Any charge for it was refunded."}
        </EmptyState>
      ) : (
        <>
          <div className="cs-legacy-bar">
            <div className="cs-legacy-acts">
              {shareUrl && (
                <a className="btn sm" href={shareUrl} target="_blank" rel="noopener noreferrer">
                  <Icon name="ext" /> Public page
                </a>
              )}
              <button type="button" className={task.shareToken ? "btn sm" : "btn p sm"} onClick={toggleShare} aria-busy={busy} disabled={busy}>
                <Icon name="share" />
                {task.shareToken ? "Stop sharing" : "Share"}
              </button>
            </div>
            <ExportMenu
              title={title}
              markdown={markdown}
              sources={task.sources}
              meta={{ date: task.completedAt, version: latest?.version ?? 1, label: "Earlier report", note: LEGACY_NOTE }}
            />
          </div>
          <ReportView
            markdown={markdown}
            sources={task.sources}
            disclaimer={LEGACY_NOTE}
            sourcesNote="The sources gathered when this report was made. Open them to check a claim before you rely on it."
          />
        </>
      )}
    </div>
  );
}
