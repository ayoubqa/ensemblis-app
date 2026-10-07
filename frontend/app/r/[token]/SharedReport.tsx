"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type PublicReport } from "@/lib/api";
import { Avatar, EmptyState, Icon, Mark, Skeleton, SkeletonText } from "@/components";
import { ExportMenu, ReportView, reportTitle } from "@/components/report";
import { longDate } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import S from "./shared.module.css";

type State = { kind: "loading" } | { kind: "ok"; report: PublicReport } | { kind: "missing" } | { kind: "error"; message: string };

/** Public, read-only report at /r/<token>. No auth. */
export function SharedReport({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { report } = await api.getPublicReport(token);
      if (!report || typeof report.result !== "string") setState({ kind: "missing" });
      else setState({ kind: "ok", report });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      if ([400, 403, 404, 410].includes(status)) setState({ kind: "missing" });
      else setState({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong" });
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.kind === "missing") {
    return (
      <div className="narrow" style={{ padding: "56px 0" }}>
        <EmptyState
          icon="lock"
          title="This link isn't active"
          action={
            <div className="row wrapflex" style={{ justifyContent: "center", gap: 10 }}>
              <Link className="btn p" href={ROUTES.examples}>
                See example reports
              </Link>
              <Link className="btn" href={ROUTES.newTask}>
                Create your own
              </Link>
            </div>
          }
        >
          The owner may have stopped sharing this report, or the link is incomplete. Ask them for a fresh link.
        </EmptyState>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="narrow" style={{ padding: "56px 0" }}>
        <div className="notice" role="alert">
          <Icon name="alert" />
          <span className="sp">{state.message}</span>
          <button type="button" className="btn sm" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="wrap" style={{ paddingTop: 22 }} aria-busy="true" aria-label="Loading the shared report">
        <Skeleton height={46} radius={14} />
        <div style={{ padding: "34px 0 22px" }}>
          <Skeleton width={160} height={20} />
          <Skeleton width="70%" height={44} style={{ marginTop: 16 }} />
          <Skeleton width="40%" height={14} style={{ marginTop: 18 }} />
        </div>
        <div className="card" style={{ padding: 28 }}>
          <SkeletonText lines={8} />
        </div>
      </div>
    );
  }

  const r = state.report;
  const title = reportTitle(r.result) || r.title;
  const team = r.team ?? [];
  const lead = r.leadAgent;
  const names = team.length ? team.map((t) => t.agentName) : lead ? [lead.name] : [];
  const unique = Array.from(new Set(names));

  return (
    <>
      <div className="wrap" style={{ paddingTop: 22 }}>
        <div className={S.bar}>
          <Link href={ROUTES.home} className={S.brand}>
            <Mark size={22} />
            <span>
              Shared report · made with <b>Ensemblis</b>
            </span>
          </Link>
          <ExportMenu
            title={title}
            markdown={r.result}
            sources={r.sources}
            meta={{ date: r.completedAt, depth: r.depth, agent: lead?.name ?? null, version: r.version, label: "Shared report" }}
          />
        </div>

        <header className={S.head}>
          <div className="row wrapflex" style={{ gap: 8 }}>
            {r.category && <span className="tag">{r.category}</span>}
            <span className="tag gray">
              {r.depth.charAt(0).toUpperCase() + r.depth.slice(1)} depth
            </span>
            {r.version > 1 && <span className="tag gray">Version {r.version}</span>}
            {r.sources?.length > 0 && <span className="tag gray">{r.sources.length} sources</span>}
          </div>
          <h1>{title}</h1>
          <div className={S.byline}>
            {unique.length > 0 && (
              <span className={S.stack} aria-hidden="true">
                {unique.slice(0, 4).map((n) => (
                  <Avatar key={n} name={n} hue={lead && lead.name === n ? lead.hue : undefined} size="xs" />
                ))}
              </span>
            )}
            <span>
              {unique.length > 1 ? `Produced by a team of ${unique.length} AI agents` : "Produced by an AI agent"}
              {lead ? (
                <>
                  , led by <b style={{ color: "var(--ink)" }}>{lead.name}</b>
                </>
              ) : null}
            </span>
            {r.completedAt && <span>· {longDate(r.completedAt)}</span>}
          </div>
        </header>

        <ReportView markdown={r.result} sources={r.sources} idPrefix="s" tocExtra={[{ id: "about", label: "How this was made" }]}>
          <section id="about" className="card" style={{ marginTop: 20, scrollMarginTop: 84 }} aria-labelledby="about-h">
            <h3 id="about-h">How this report was made</h3>
            <p className="small muted" style={{ marginTop: 4, maxWidth: "62ch" }}>
              Someone described the outcome they needed on Ensemblis. A team of specialised AI agents took it from there: each step hands its work to the next, and
              the final report cites the numbered sources the team gathered.
            </p>
            {team.length > 0 && (
              <ol className={S.team}>
                {team.map((m, i) => (
                  <li key={`${m.agentName}-${i}`}>
                    <span className="tiny muted" style={{ width: 22, fontWeight: 700 }}>
                      0{i + 1}
                    </span>
                    <Avatar name={m.agentName} hue={lead && lead.name === m.agentName ? lead.hue : undefined} size="sm" />
                    <div className="sp" style={{ minWidth: 0 }}>
                      <b className="small">{m.agentName}</b>
                      <div className="tiny muted">
                        {m.role} · {m.title}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <p className="tiny muted" style={{ marginTop: 12 }}>
              Shared with a private link. Only this report is visible here, not the owner&apos;s account or other work.
            </p>
          </section>
        </ReportView>
      </div>

      <section className={`dk cta-band ${S.cta}`} style={{ marginTop: 48 }}>
        <div className="wrap">
          <div className="eyebrow">MADE WITH ENSEMBLIS</div>
          <h2>Get a report like this for your own question.</h2>
          <p>Describe the outcome you need. A team of AI agents researches, writes and checks it, with numbered sources you can open.</p>
          <div className="row wrapflex" style={{ marginTop: 26 }}>
            <Link className="btn p lg" href={ROUTES.newTask}>
              Get a report like this
              <Icon name="arrow" />
            </Link>
            <Link className="btn lg" href={ROUTES.examples}>
              See more examples
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
