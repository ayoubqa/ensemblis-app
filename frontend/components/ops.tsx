"use client";

// Shared building blocks of the operations console: approvals, exceptions,
// the event feed, executive identity. Used by the objective console, the
// dashboard and the Approval / Exception centers. Styles: app/styles/console.css (cs-*).

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import { api, type Approval, type Evidence, type ExceptionAction, type ExceptionItem, type ExecutionEvent, type ExecutiveKey, type TaskSource } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { credits, relativeTime } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { EVIDENCE_KIND_LABEL, type LabelledSource } from "./report/shared";
import { Icon, type IconName } from "./Icon";
import { RiskTag, Tag, exceptionKindLabel } from "./Tags";
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

const CARDS = '[data-testid="approval-card"], [data-testid="exception-card"]';

function focusEl(el: HTMLElement) {
  if (!el.matches("a[href], button, input, select, textarea, [tabindex]")) el.setAttribute("tabindex", "-1");
  el.focus();
}

/**
 * A decision reloads the list it was made in, which removes the card (or at least its
 * buttons), so focus would fall back to <body>. Before the reload, note where focus should
 * go; the returned function moves it there once the list has re-rendered, unless focus has
 * already landed somewhere. Order: this card's heading (when it stays, shown decided), the
 * next decision card, the previous one, the caller's `focusAfter` element, the heading of
 * the section (or tab panel) that held the card, and finally the page's h1.
 */
function planFocus(card: HTMLElement | null, focusAfter?: string): () => void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>(CARDS));
  const i = card ? cards.indexOf(card) : -1;
  const order = i < 0 ? cards : [cards[i], ...cards.slice(i + 1), ...cards.slice(0, i).reverse()];
  const ids = order.map((c) => c.querySelector<HTMLElement>(".cs-dc-title")?.id).filter((x): x is string => !!x);
  if (focusAfter) ids.push(focusAfter);
  const holders: HTMLElement[] = [];
  for (let el = card?.parentElement ?? null; el && el !== document.body; el = el.parentElement) {
    const label = el.getAttribute("aria-labelledby");
    if (label) ids.push(label.split(" ")[0]);
    if (el.getAttribute("role") === "tabpanel") holders.push(el);
  }
  return () => {
    const run = () => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const target =
        ids.map((x) => document.getElementById(x)).find((el): el is HTMLElement => !!el) ??
        holders.find((el) => el.isConnected) ??
        document.querySelector<HTMLElement>("main h1");
      if (target) focusEl(target);
    };
    // After the reload resolves React still has to commit the new list.
    requestAnimationFrame(() => requestAnimationFrame(run));
  };
}

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

/** Props shared by the decision cards. `onDone` reloads the list (awaited when it returns a promise); `focusAfter` is the id of the element that takes focus when no other decision card is left. */
interface DecisionProps {
  onDone?: () => unknown;
  focusAfter?: string;
  showObjective?: boolean;
}

/** A decision with the context needed to make it, and Approve / Reject. Also renders the decided record. */
export function ApprovalCard({ approval, onDone, focusAfter, showObjective = false }: DecisionProps & { approval: Approval }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const uid = useId().replace(/:/g, "");
  const ref = useRef<HTMLElement>(null);
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
      const restore = planFocus(ref.current, focusAfter);
      await Promise.resolve(onDone?.()).catch(() => undefined);
      restore();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const decided = approval.status === "APPROVED" ? "Approved" : approval.status === "REJECTED" ? "Rejected" : "Withdrawn";
  return (
    <article ref={ref} className={`cs-dc cs-dc-approval${pending ? " is-open" : " is-closed"}`} data-testid="approval-card" aria-labelledby={`${uid}-t`}>
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
      <h3 id={`${uid}-t`} className="cs-dc-title" tabIndex={-1}>
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
            <b className="cs-dc-amt">{credits(approval.costCents)}</b>
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
              Approve{approval.costCents ? ` · ${credits(approval.costCents)}` : ""}
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
  skip: "Continue without this step",
  accept: "Accept with warnings",
  cancel: "Cancel execution",
};

const ACTION_DONE: Partial<Record<ExceptionAction, string>> = {
  cancel: "Execution cancelled",
  provide_info: "Thanks — the Chief of Staff is re-planning",
  skip: "Continuing without this step — the result will be marked partial",
};

/** An exception: what happened, why it matters, the recommendation, what is needed — and the actions that resolve it. */
export function ExceptionCard({ exception, onDone, focusAfter, showObjective = false }: DecisionProps & { exception: ExceptionItem }) {
  const toast = useToast();
  const { refresh } = useAuth();
  const uid = useId().replace(/:/g, "");
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<ExceptionAction | null>(null);
  const [response, setResponse] = useState("");
  const open = exception.status === "OPEN";
  const needsText = exception.actions.includes("provide_info");
  const allowsGuidance = exception.kind === "VERIFICATION_FAILED";
  const high = exception.severity === "HIGH";
  // "Send answer" stays disabled until the answer says something; the hint says why.
  const tooShort = needsText && response.trim().length < 3;
  const act = async (a: ExceptionAction) => {
    if (a === "cancel" && !window.confirm("Cancel this execution? Work that wasn't executed is refunded.")) return;
    setBusy(a);
    try {
      await api.resolveException(exception.id, a, response.trim() || undefined);
      toast(
        a === "retry" && exception.kind === "PROVIDER_UNAVAILABLE" ? "Retrying — the Chief of Staff is planning again" : ACTION_DONE[a] ?? "Resumed"
      );
      refreshAttention();
      refresh().catch(() => undefined);
      const restore = planFocus(ref.current, focusAfter);
      await Promise.resolve(onDone?.()).catch(() => undefined);
      restore();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <article ref={ref} className={`cs-dc cs-dc-exception${high ? " is-high" : ""}${open ? " is-open" : " is-closed"}`} data-testid="exception-card" aria-labelledby={`${uid}-t`}>
      <div className="cs-dc-top">
        <span className="cs-dc-ic" aria-hidden="true">
          <Icon name="alert" size={16} />
        </span>
        <span className="cs-dc-kind">
          Exception · {exceptionKindLabel(exception.kind)}
        </span>
        {high && <Tag variant="bad">High severity</Tag>}
        <span className="cs-dc-time">{relativeTime(exception.createdAt)}</span>
      </div>
      <h3 id={`${uid}-t`} className="cs-dc-title" tabIndex={-1}>
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
                aria-describedby={tooShort ? `${uid}-why` : undefined}
              />
              {tooShort && (
                <p id={`${uid}-why`} className="cs-dc-why">
                  Write at least 3 characters to send your answer.
                </p>
              )}
            </>
          )}
          {exception.actions.includes("skip") && (
            <p className="cs-dc-note" id={`${uid}-skip`}>
              Continuing without this step finishes the work without it: the result is marked partial and this step&apos;s cost is refunded.
            </p>
          )}
          <div className="cs-dc-btns">
            {exception.actions.map((a, i) => (
              <button
                key={a}
                type="button"
                className={i === 0 ? "btn p" : a === "cancel" ? "btn bad" : "btn"}
                onClick={() => act(a)}
                aria-busy={busy === a}
                disabled={!!busy || (a === "provide_info" && tooShort)}
                aria-describedby={a === "provide_info" && tooShort ? `${uid}-why` : a === "skip" ? `${uid}-skip` : undefined}
              >
                {ACTION_LABEL[a] ?? a.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="cs-dc-done s-RESOLVED">
          <Icon name="check" size={14} />
          <span>
            Resolved ({exception.resolvedAction === "skip" ? "continued without the step" : (exception.resolvedAction ?? "").replace("_", " ")}) {relativeTime(exception.resolvedAt)}
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

