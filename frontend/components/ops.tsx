"use client";

// Shared building blocks of the operations console: approvals, exceptions,
// the event feed, executive identity. Used by the objective page, the
// dashboard and the Approval / Exception centers.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { api, type Approval, type Evidence, type ExceptionAction, type ExceptionItem, type ExecutionEvent, type ExecutiveKey, type TaskSource } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { eur, relativeTime } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { Icon, type IconName } from "./Icon";
import { RiskTag, Tag } from "./Tags";
import { useToast } from "./Toast";
import { refreshAttention } from "./Header";

export const EXEC_ICON: Record<string, IconName> = {
  chief_of_staff: "compass",
  marketing: "globe",
  sales: "zap",
  finance: "eur",
  operations: "settings",
  user: "user",
  system: "shield",
};

export function ExecBadge({ executive, size = 30 }: { executive: ExecutiveKey | string; size?: number }) {
  return (
    <span className="exec-badge" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={EXEC_ICON[executive] ?? "spark"} size={Math.round(size * 0.5)} />
    </span>
  );
}

/** Evidence in the citation components' source shape. */
export function evidenceToSources(evidence: Evidence[]): TaskSource[] {
  return evidence.map((e) => ({ n: e.n, kind: e.sourceKind, title: e.title, url: e.url, domain: e.domain, snippet: e.snippet, publishedAt: e.publishedAt }));
}

export function Section({ id, title, count, right, children, style }: { id?: string; title: string; count?: ReactNode; right?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section id={id} className="section" style={{ scrollMarginTop: 84, ...style }}>
      <div className="row between" style={{ marginBottom: 10, alignItems: "baseline" }}>
        <h2 className="sh" style={{ margin: 0 }}>
          {title}
          {count !== undefined && <span className="ct">{count}</span>}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

const KIND_LABEL: Record<Approval["kind"], string> = { PLAN: "Plan review", BUDGET: "Budget", ACTION: "External action" };

/** A pending approval with the context needed to decide, and Approve / Reject. */
export function ApprovalCard({ approval, onDone, showObjective = false }: { approval: Approval; onDone?: () => void; showObjective?: boolean }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const pending = approval.status === "PENDING";
  const decide = async (d: "approve" | "reject") => {
    setBusy(d);
    try {
      if (d === "approve") await api.approve(approval.id, note || undefined);
      else await api.reject(approval.id, note || undefined);
      toast(d === "approve" ? "Approved — the AI Team is starting" : "Rejected — nothing was charged");
      refreshAttention();
      refresh().catch(() => undefined);
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="attn" data-testid="approval-card">
      <div className="row between wrapflex" style={{ gap: 8 }}>
        <div className="row wrapflex" style={{ gap: 8 }}>
          <Tag variant="warn" icon="check">
            Approval · {KIND_LABEL[approval.kind]}
          </Tag>
          <RiskTag risk={approval.risk} />
        </div>
        <span className="tiny muted">{relativeTime(approval.createdAt)}</span>
      </div>
      <h3>{approval.title}</h3>
      {showObjective && approval.objectiveTitle && (
        <Link href={ROUTES.objective(approval.objectiveId)} className="small" style={{ color: "var(--accent)" }}>
          {approval.objectiveTitle} →
        </Link>
      )}
      <dl>
        <dt>Proposed action</dt>
        <dd>{approval.proposedAction}</dd>
        <dt>Why approval is needed</dt>
        <dd>{approval.reason}</dd>
        <dt>Cost</dt>
        <dd>
          <b>{eur(approval.costCents, { decimals: true })}</b> <span className="muted">charged only if you approve; refunded for work that fails or doesn&apos;t run</span>
        </dd>
        <dt>Recommendation</dt>
        <dd>
          <b>{approval.recommendedDecision === "APPROVE" ? "Approve" : "Reject"}</b> — {approval.recommendation}
        </dd>
      </dl>
      {pending ? (
        <>
          <input className="f" style={{ marginTop: 14 }} placeholder="Optional note for the record" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" />
          <div className="row wrapflex" style={{ marginTop: 12 }}>
            <button type="button" className="btn p" onClick={() => decide("approve")} aria-busy={busy === "approve"} disabled={!!busy}>
              <Icon name="check" />
              Approve{approval.costCents ? ` · ${eur(approval.costCents, { decimals: true })}` : ""}
            </button>
            <button type="button" className="btn" onClick={() => decide("reject")} aria-busy={busy === "reject"} disabled={!!busy}>
              Reject
            </button>
          </div>
        </>
      ) : (
        <p className="small muted" style={{ marginTop: 10 }}>
          {approval.status === "APPROVED" ? "Approved" : approval.status === "REJECTED" ? "Rejected" : "Cancelled"} {relativeTime(approval.decidedAt)}
          {approval.decisionNote ? ` — “${approval.decisionNote}”` : ""}
        </p>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<ExceptionAction, string> = {
  provide_info: "Send answer",
  proceed: "Proceed with assumptions",
  retry: "Retry",
  accept: "Accept with warnings",
  cancel: "Cancel execution",
};

const EXC_KIND: Record<ExceptionItem["kind"], string> = {
  MISSING_INFORMATION: "Missing information",
  STEP_FAILED: "Step failed",
  VERIFICATION_FAILED: "Verification failed",
  INSUFFICIENT_FUNDS: "Insufficient balance",
  POLICY_BLOCKED: "Blocked by policy",
};

/** An exception: what happened, why it matters, the recommendation, what is needed — and the actions that resolve it. */
export function ExceptionCard({ exception, onDone, showObjective = false }: { exception: ExceptionItem; onDone?: () => void; showObjective?: boolean }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const [busy, setBusy] = useState<ExceptionAction | null>(null);
  const [response, setResponse] = useState("");
  const open = exception.status === "OPEN";
  const needsText = exception.actions.includes("provide_info");
  const allowsGuidance = exception.kind === "VERIFICATION_FAILED";
  const act = async (a: ExceptionAction) => {
    if (a === "cancel" && !window.confirm("Cancel this execution? Work that didn't run is refunded.")) return;
    setBusy(a);
    try {
      await api.resolveException(exception.id, a, response.trim() || undefined);
      toast(a === "cancel" ? "Execution cancelled" : a === "provide_info" ? "Thanks — the Chief of Staff is re-planning" : "Resumed");
      refreshAttention();
      refresh().catch(() => undefined);
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={exception.severity === "HIGH" ? "attn bad" : "attn"} data-testid="exception-card">
      <div className="row between wrapflex" style={{ gap: 8 }}>
        <Tag variant={exception.severity === "HIGH" ? "bad" : "warn"} icon="alert">
          Exception · {EXC_KIND[exception.kind]}
        </Tag>
        <span className="tiny muted">{relativeTime(exception.createdAt)}</span>
      </div>
      <h3>{exception.title}</h3>
      {showObjective && exception.objectiveTitle && (
        <Link href={ROUTES.objective(exception.objectiveId)} className="small" style={{ color: "var(--accent)" }}>
          {exception.objectiveTitle} →
        </Link>
      )}
      <dl>
        <dt>What happened</dt>
        <dd>{exception.whatHappened}</dd>
        <dt>Why it matters</dt>
        <dd>{exception.whyItMatters}</dd>
        <dt>Recommendation</dt>
        <dd>{exception.recommendation}</dd>
        <dt>Needed from you</dt>
        <dd>
          {exception.questions.length ? (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {exception.questions.map((q) => (
                <li key={q.question}>{q.question}</li>
              ))}
            </ul>
          ) : (
            exception.neededFromUser
          )}
        </dd>
      </dl>
      {open ? (
        <>
          {(needsText || allowsGuidance) && (
            <textarea
              className="f"
              rows={3}
              style={{ marginTop: 14 }}
              placeholder={needsText ? "Your answer (it is added to this objective's context)" : "Optional guidance for the revision"}
              value={response}
              maxLength={4000}
              onChange={(e) => setResponse(e.target.value)}
              aria-label={needsText ? "Your answer" : "Guidance"}
            />
          )}
          <div className="row wrapflex" style={{ marginTop: 12 }}>
            {exception.actions.map((a, i) => (
              <button
                key={a}
                type="button"
                className={i === 0 ? "btn p" : a === "cancel" ? "btn bad" : "btn"}
                onClick={() => act(a)}
                aria-busy={busy === a}
                disabled={!!busy || (a === "provide_info" && response.trim().length < 3)}
              >
                {ACTION_LABEL[a]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="small muted" style={{ marginTop: 10 }}>
          Resolved ({(exception.resolvedAction ?? "").replace("_", " ")}) {relativeTime(exception.resolvedAt)}
          {exception.resolution ? ` — “${exception.resolution.slice(0, 160)}”` : ""}
        </p>
      )}
    </div>
  );
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** The persistent event log, newest first. */
export function EventFeed({ events, limit = 60, linkObjectives = false }: { events: (ExecutionEvent & { objectiveId?: string; objectiveTitle?: string })[]; limit?: number; linkObjectives?: boolean }) {
  const list = [...events].sort((a, b) => b.id - a.id).slice(0, limit);
  if (!list.length) return <p className="small muted">Nothing has happened yet.</p>;
  return (
    <ol className="feed" aria-label="Execution events">
      {list.map((e) => (
        <li key={e.id}>
          <time dateTime={e.createdAt} title={new Date(e.createdAt).toLocaleString()}>
            {hhmm(e.createdAt)}
          </time>
          <div className={`t-${e.type}`}>
            <span className="who">{e.actorTitle}</span>
            <span style={{ color: "var(--ink)" }}>{e.message}</span>
            {linkObjectives && e.objectiveId && (
              <div className="tiny">
                <Link href={ROUTES.objective(e.objectiveId)} className="muted">
                  {e.objectiveTitle}
                </Link>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Money({ cents }: { cents: number }) {
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{eur(cents, { decimals: true })}</span>;
}
