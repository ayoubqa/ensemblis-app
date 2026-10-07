"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError, type LegacyTask } from "@/lib/api";
import { EmptyState, Icon, PageSkeleton, RequireAuth, useToast } from "@/components";
import { ExportMenu, ReportView, reportTitle } from "@/components/report";
import { eur, longDate } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

export default function LegacyReportPage() {
  return (
    <RequireAuth>
      <LegacyReport />
    </RequireAuth>
  );
}

/** Read-only view of a report produced before objectives existed (v1–v3 tasks). */
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

  if (error) {
    const missing = error instanceof ApiError && [403, 404].includes(error.status);
    return (
      <div className="narrow" style={{ padding: "56px 0" }}>
        <EmptyState icon="file" title={missing ? "Report not found" : "Couldn't load this report"} action={{ label: "Back to objectives", href: `${ROUTES.objectives}?group=earlier` }}>
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

  const toggleShare = async () => {
    setBusy(true);
    try {
      const { task: t } = await api.shareLegacyReport(task.id, !task.shareToken);
      setTask((cur) => (cur ? { ...cur, shareToken: t.shareToken } : cur));
      if (t.shareToken) {
        await navigator.clipboard?.writeText(`${window.location.origin}${ROUTES.sharedReport(t.shareToken)}`).catch(() => undefined);
        toast("Public link created and copied");
      } else toast("Public link turned off");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="pagehead">
        <Link href={`${ROUTES.objectives}?group=earlier`} className="small muted">
          ← Earlier reports
        </Link>
        <div className="row wrapflex" style={{ gap: 8, marginTop: 10 }}>
          <span className="tag gray">Earlier report · read-only</span>
          {task.category && <span className="tag gray">{task.category}</span>}
          {latest && latest.version > 1 && <span className="tag gray">Version {latest.version}</span>}
        </div>
        <h1 style={{ marginTop: 10 }}>{title}</h1>
        <p className="small muted">
          {task.createdBy.name} · {longDate(task.completedAt ?? task.createdAt)} · {eur(task.costCents, { decimals: true })}
        </p>
      </div>

      <div className="banner-info" style={{ marginBottom: 16 }}>
        <Icon name="info" size={15} />
        <span className="small">
          This report was produced before objectives existed, so it has no success criteria or verification. To build on it,{" "}
          <Link href={ROUTES.newObjective} style={{ color: "var(--accent)", fontWeight: 600 }}>
            define an outcome
          </Link>
          .
        </span>
      </div>

      {task.status !== "COMPLETED" || !markdown.trim() ? (
        <EmptyState icon="alert" title="No report was produced">
          {task.errorMessage ?? "This run didn't finish. Any charge for it was refunded."}
        </EmptyState>
      ) : (
        <>
          <div className="row wrapflex" style={{ gap: 8, marginBottom: 14 }}>
            <ExportMenu title={title} markdown={markdown} sources={task.sources} meta={{ date: task.completedAt, depth: task.depth, agent: null, version: latest?.version ?? 1, label: "Report" }} />
            {shareUrl && (
              <a className="btn sm" href={shareUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="ext" /> Public page
              </a>
            )}
            <button type="button" className="btn sm" onClick={toggleShare} aria-busy={busy} disabled={busy}>
              <Icon name="share" />
              {task.shareToken ? "Stop sharing" : "Share"}
            </button>
          </div>
          <ReportView markdown={markdown} sources={task.sources} />
        </>
      )}
    </div>
  );
}
