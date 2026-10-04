import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Avatar, Icon, SampleTag, VerifiedTag } from "@/components";
import type { Agent } from "@/lib/api";
import { duration, eur, num, pct } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

export type CardAgent = Pick<
  Agent,
  | "slug"
  | "name"
  | "creator"
  | "description"
  | "capabilities"
  | "successRate"
  | "tasksCompleted"
  | "avgRunSeconds"
  | "pricePerTaskCents"
  | "verified"
  | "hue"
  | "rating"
  | "category"
>;

/** /new prefilled with an agent (and optionally the task text). */
export function newTaskUrl(opts: { agent?: string; text?: string } = {}): string {
  const q = new URLSearchParams();
  if (opts.agent) q.set("agent", opts.agent);
  if (opts.text) q.set("q", opts.text); // /new reads ?q=
  const s = q.toString();
  return s ? `${ROUTES.newTask}?${s}` : ROUTES.newTask;
}

/** True for agents with no track record yet (newly published). */
export const isNew = (a: Pick<Agent, "tasksCompleted" | "successRate">) => a.tasksCompleted === 0 && a.successRate === 0;

/** Wraps the first case-insensitive match of `q` in a <mark>. */
function highlight(text: string, q?: string): ReactNode {
  const t = q?.trim();
  if (!t) return text;
  const i = text.toLowerCase().indexOf(t.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: "var(--accent-soft)", color: "inherit", borderRadius: 4, padding: "0 2px" }}>{text.slice(i, i + t.length)}</mark>
      {text.slice(i + t.length)}
    </>
  );
}

/**
 * Prototype `agentCard()` — the Explore grid card. With `preview` it renders a
 * non-interactive <div> (used by the publish wizard's live preview).
 */
export function AgentCard({ agent: a, query, preview, style }: { agent: CardAgent; query?: string; preview?: boolean; style?: CSSProperties }) {
  const fresh = isNew(a);
  const body = (
    <>
      <div className="row">
        <Avatar name={a.name || "New agent"} hue={a.hue} />
        <div className="sp" style={{ minWidth: 0 }}>
          <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{highlight(a.name || "Untitled agent", query)}</b>
          <div className="tiny muted">by {a.creator}</div>
        </div>
        <VerifiedTag verified={a.verified} compact />
      </div>
      <p className="small muted" style={{ minHeight: 40 }}>
        {a.description ? highlight(a.description, query) : <span style={{ opacity: 0.6 }}>Describe the outcome customers get…</span>}
      </p>
      <div className="row wrapflex" style={{ gap: 6 }}>
        {a.capabilities.slice(0, 3).map((c) => (
          <span key={c} className="chip" style={{ padding: "2px 9px", fontSize: 12 }}>
            {c}
          </span>
        ))}
        {a.capabilities.length > 3 && <span className="tiny muted">+{a.capabilities.length - 3}</span>}
      </div>
      <div className="stats">
        {fresh ? (
          <>
            <span>
              <span className="tag" style={{ padding: "1px 8px" }}>
                <Icon name="spark" />
                New
              </span>
            </span>
            <span>No track record yet</span>
          </>
        ) : (
          <>
            <span>
              <b>{pct(a.successRate)}</b> success
            </span>
            <span>
              <b>{num(a.tasksCompleted)}</b> tasks
            </span>
          </>
        )}
        <span>
          <b>{duration(a.avgRunSeconds)}</b> avg
        </span>
      </div>
      <div className="tiny muted row" style={{ gap: 6 }}>
        {a.rating > 0 && (
          <>
            <span className="rating" style={{ fontSize: 12 }}>
              <Icon name="star" />
              {a.rating.toFixed(1)}
            </span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>{a.category}</span>
        {!preview && !fresh && (
          <>
            <span className="sp" />
            <SampleTag label="Sample stats" />
          </>
        )}
      </div>
      <div className="row between small">
        <span className="muted">
          Typical <b style={{ color: "var(--ink)" }}>{eur(a.pricePerTaskCents)}</b>
        </span>
        <span className="btn sm">View agent</span>
      </div>
    </>
  );
  if (preview)
    return (
      <div className="card acard" style={{ cursor: "default", ...style }} aria-label="Marketplace preview">
        {body}
      </div>
    );
  return (
    <Link href={ROUTES.agent(a.slug)} className="card acard" style={style}>
      {body}
    </Link>
  );
}

/** Prototype loading shimmer for one card. */
export function AgentCardSkeleton() {
  return (
    <div className="card" aria-hidden="true">
      <div className="row">
        <div className="sk" style={{ width: 40, height: 40 }} />
        <div className="sp">
          <div className="sk" style={{ height: 12, width: "60%" }} />
          <div className="sk" style={{ height: 10, width: "35%", marginTop: 6 }} />
        </div>
      </div>
      <div className="sk" style={{ height: 12, marginTop: 16 }} />
      <div className="sk" style={{ height: 12, marginTop: 8, width: "80%" }} />
      <div className="row" style={{ gap: 6, marginTop: 14 }}>
        <div className="sk" style={{ height: 20, width: 80, borderRadius: 999 }} />
        <div className="sk" style={{ height: 20, width: 64, borderRadius: 999 }} />
      </div>
      <div className="sk" style={{ height: 12, marginTop: 18, width: "70%" }} />
    </div>
  );
}
