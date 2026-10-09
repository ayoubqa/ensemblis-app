"use client";

// Shared building blocks of the operations console: approvals, exceptions,
// the event feed, executive identity. Used by the objective console, the
// dashboard and the Approval / Exception centers. Styles: app/styles/console.css (cs-*).

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { api, type Approval, type Evidence, type ExceptionAction, type ExceptionItem, type ExecutionEvent, type ExecutiveKey, type TaskSource } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { eur, relativeTime } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { EVIDENCE_KIND_LABEL, type LabelledSource } from "./report/shared";
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

export const EXEC_LABEL: Record<string, string> = {
  chief_of_staff: "Chief of Staff",
  marketing: "Marketing",
  sales: "Sales",
  finance: "Finance",
  operations: "Operations",
};

/** Executive identity badge. Decorative unless `label` is given. */
export function ExecBadge({ executive, size = 30, label }: { executive: ExecutiveKey | string; size?: number; label?: string }) {
  return (
    <span
      className="exec-badge"
      style={{ width: size, height: size }}
      {...(label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true })}
    >
      <Icon name={EXEC_ICON[executive] ?? "spark"} size={Math.round(size * 0.5)} />
    </span>
  );
}

/**
 * Evidence in the citation components' source shape. `label` carries the precise
 * kind (company context, calculation…), which the API's sourceKind collapses to "upload".
 */
export function evidenceToSources(evidence: Evidence[]): TaskSource[] {
  return evidence.map(
    (e): LabelledSource => ({
      n: e.n,
      kind: e.sourceKind,
      title: e.title,
      url: e.url,
      domain: e.domain,
      snippet: e.snippet,
      publishedAt: e.publishedAt,
      label: EVIDENCE_KIND_LABEL[e.kind] ?? null,
    })
  );
}

export function Section({ id, title, count, right, children, style }: { id?: string; title: string; count?: ReactNode; right?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section id={id} className="section" style={{ scrollMarginTop: 84, ...style }}>
      <div className="row between" style={{ marginBottom: 10, alignItems: "baseline", flexWrap: "wrap", gap: "6px 12px" }}>
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

/**
 * "Approve — The plan is…". The backend text often opens with the decision
 * itself ("Approve. The plan is…"): that word is shown once, as the verdict.
 */
function Recommendation({ decision, text }: { decision: Approval["recommendedDecision"]; text: string }) {
  const verdict = decision === "APPROVE" ? "Approve" : "Reject";
  const lead = new RegExp(`^\\s*${verdict}\\b\\s*[.:;,!—–-]*\\s*`, "i").exec(text);
  const rest = lead ? text.slice(lead[0].length) : text.trim();
  return (
    <p>
      <b className={`cs-dc-verdict v-${decision === "APPROVE" ? "approve" : "reject"}`}>{verdict}</b>
      {rest ? <> — {rest.charAt(0).toUpperCase() + rest.slice(1)}</> : null}
    </p>
  );
}

/** A decision with the context needed to make it, and Approve / Reject. Also renders the decided record. */
export function ApprovalCard({ approval, onDone, showObjective = false }: { approval: Approval; onDone?: () => void; showObjective?: boolean }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const uid = useId().replace(/:/g, "");
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
  const decided = approval.status === "APPROVED" ? "Approved" : approval.status === "REJECTED" ? "Rejected" : "Withdrawn";
  return (
    <article className={`cs-dc cs-dc-approval${pending ? " is-open" : " is-closed"}`} data-testid="approval-card" aria-labelledby={`${uid}-t`}>
      <div className="cs-dc-top">
        <span className="cs-dc-ic" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
        <span className="cs-dc-kind">
          {pending ? "Approval needed" : "Approval"} · {KIND_LABEL[approval.kind]}
        </span>
        <RiskTag risk={approval.risk} />
        <span className="cs-dc-time">{relativeTime(approval.createdAt)}</span>
      </div>
      <h3 id={`${uid}-t`} className="cs-dc-title">
        {approval.title}
      </h3>
      {showObjective && approval.objectiveTitle && (
        <Link href={ROUTES.objective(approval.objectiveId)} className="cs-dc-obj">
          <Icon name="target" size={14} />
          {approval.objectiveTitle}
        </Link>
      )}
      <dl className="cs-dc-dl">
        <div>
          <dt>Proposed action</dt>
          <dd>{approval.proposedAction}</dd>
        </div>
        <div>
          <dt>Why approval is needed</dt>
          <dd>{approval.reason}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>
            <b className="cs-dc-amt">{eur(approval.costCents, { decimals: true })}</b>
            <span className="cs-dc-sub">Charged only if you approve. Refunded for work that fails or isn&apos;t executed.</span>
          </dd>
        </div>
      </dl>
      <div className="cs-dc-rec">
        <span className="cs-dc-rec-k">
          <Icon name="compass" size={14} />
          Recommendation
        </span>
        <Recommendation decision={approval.recommendedDecision} text={approval.recommendation} />
      </div>
      {pending ? (
        <div className="cs-dc-act">
          <label className="cs-dc-lbl" htmlFor={`${uid}-note`}>
            Note for the record <span>(optional)</span>
          </label>
          <input id={`${uid}-note`} className="f" placeholder="Why you decided this way" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <div className="cs-dc-btns">
            <button type="button" className="btn p" onClick={() => decide("approve")} aria-busy={busy === "approve"} disabled={!!busy}>
              <Icon name="check" />
              Approve{approval.costCents ? ` · ${eur(approval.costCents, { decimals: true })}` : ""}
            </button>
            <button type="button" className="btn" onClick={() => decide("reject")} aria-busy={busy === "reject"} disabled={!!busy}>
              Reject
            </button>
          </div>
        </div>
      ) : (
        <p className={`cs-dc-done s-${approval.status}`}>
          <Icon name={approval.status === "APPROVED" ? "check" : "x"} size={14} />
          <span>
            <b>{decided}</b> {relativeTime(approval.decidedAt)}
            {approval.decisionNote ? ` — “${approval.decisionNote}”` : ""}
          </span>
        </p>
      )}
    </article>
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
  const uid = useId().replace(/:/g, "");
  const [busy, setBusy] = useState<ExceptionAction | null>(null);
  const [response, setResponse] = useState("");
  const open = exception.status === "OPEN";
  const needsText = exception.actions.includes("provide_info");
  const allowsGuidance = exception.kind === "VERIFICATION_FAILED";
  const high = exception.severity === "HIGH";
  const act = async (a: ExceptionAction) => {
    if (a === "cancel" && !window.confirm("Cancel this execution? Work that wasn't executed is refunded.")) return;
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
    <article className={`cs-dc cs-dc-exception${high ? " is-high" : ""}${open ? " is-open" : " is-closed"}`} data-testid="exception-card" aria-labelledby={`${uid}-t`}>
      <div className="cs-dc-top">
        <span className="cs-dc-ic" aria-hidden="true">
          <Icon name="alert" size={16} />
        </span>
        <span className="cs-dc-kind">
          Exception · {EXC_KIND[exception.kind]}
        </span>
        {high && <Tag variant="bad">High severity</Tag>}
        <span className="cs-dc-time">{relativeTime(exception.createdAt)}</span>
      </div>
      <h3 id={`${uid}-t`} className="cs-dc-title">
        {exception.title}
      </h3>
      {showObjective && exception.objectiveTitle && (
        <Link href={ROUTES.objective(exception.objectiveId)} className="cs-dc-obj">
          <Icon name="target" size={14} />
          {exception.objectiveTitle}
        </Link>
      )}
      <dl className="cs-dc-dl">
        <div>
          <dt>What happened</dt>
          <dd>{exception.whatHappened}</dd>
        </div>
        <div>
          <dt>Why it matters</dt>
          <dd>{exception.whyItMatters}</dd>
        </div>
        <div>
          <dt>Needed from you</dt>
          <dd>
            {exception.questions.length ? (
              <ul className="cs-dc-q">
                {exception.questions.map((q) => (
                  <li key={q.question}>{q.question}</li>
                ))}
              </ul>
            ) : (
              exception.neededFromUser
            )}
          </dd>
        </div>
      </dl>
      <div className="cs-dc-rec">
        <span className="cs-dc-rec-k">
          <Icon name="compass" size={14} />
          Recommendation
        </span>
        <p>{exception.recommendation}</p>
      </div>
      {open ? (
        <div className="cs-dc-act">
          {(needsText || allowsGuidance) && (
            <>
              <label className="cs-dc-lbl" htmlFor={`${uid}-answer`}>
                {needsText ? "Your answer" : "Guidance"}
                {!needsText && <span> (optional)</span>}
              </label>
              <textarea
                id={`${uid}-answer`}
                className="f"
                rows={3}
                placeholder={needsText ? "It's added to this objective's context" : "Anything the revision should take into account"}
                value={response}
                maxLength={4000}
                onChange={(e) => setResponse(e.target.value)}
              />
            </>
          )}
          <div className="cs-dc-btns">
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
        </div>
      ) : (
        <p className="cs-dc-done s-RESOLVED">
          <Icon name="check" size={14} />
          <span>
            Resolved ({(exception.resolvedAction ?? "").replace("_", " ")}) {relativeTime(exception.resolvedAt)}
            {exception.resolution ? ` — “${exception.resolution.slice(0, 160)}”` : ""}
          </span>
        </p>
      )}
    </article>
  );
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const stamp = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay(d, new Date()) ? t : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${t}`;
};

function tone(type: string): "bad" | "warn" | "ok" | "info" {
  if (/FAIL|EXCEPTION_CREATED|REJECTED/.test(type)) return "bad";
  if (/APPROVAL_REQUESTED|BLOCKED|EXCEPTION/.test(type)) return "warn";
  if (/COMPLETED|APPROVED|RESOLVED|PASS/.test(type)) return "ok";
  return "info";
}

/** The persistent event log, newest first. */
export function EventFeed({
  events,
  limit = 60,
  linkObjectives = false,
}: {
  events: (ExecutionEvent & { objectiveId?: string; objectiveTitle?: string })[];
  limit?: number;
  linkObjectives?: boolean;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...events].sort((a, b) => b.id - a.id);
  const list = all ? sorted : sorted.slice(0, limit);
  if (!list.length) return <p className="cs-feed-empty">Nothing has happened yet.</p>;
  return (
    <>
      <ol className="cs-feed" aria-label="Execution events">
        {list.map((e) => (
          <li key={e.id} className={`cs-feed-i tone-${tone(e.type)}`}>
            <span className="cs-feed-dot" aria-hidden="true" />
            <div className="cs-feed-b">
              <div className="cs-feed-m">
                <span className="who">{e.actorTitle}</span>
                <time dateTime={e.createdAt} title={new Date(e.createdAt).toLocaleString()}>
                  {stamp(e.createdAt)}
                </time>
              </div>
              <p>{e.message}</p>
              {linkObjectives && e.objectiveId && (
                <Link href={ROUTES.objective(e.objectiveId)} className="cs-feed-obj">
                  {e.objectiveTitle}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
      {sorted.length > list.length && (
        <button type="button" className="cs-linkbtn cs-feed-more" onClick={() => setAll(true)}>
          Show all {sorted.length} events
        </button>
      )}
    </>
  );
}

export function Money({ cents }: { cents: number }) {
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{eur(cents, { decimals: true })}</span>;
}
