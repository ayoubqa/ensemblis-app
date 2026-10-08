"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type PublicReport } from "@/lib/api";
import { Avatar, CriterionTag, EmptyState, Icon, Mark, OutcomeTag, Skeleton, SkeletonText, VerificationTag } from "@/components";
import { ExecBadge } from "@/components/ops";
import { ExportMenu, ReportView, reportTitle } from "@/components/report";
import { longDate, plural } from "@/lib/format";
import { useConfig } from "@/lib/config";
import { ROUTES } from "@/lib/routes";
import S from "./shared.module.css";

type State = { kind: "loading" } | { kind: "ok"; report: PublicReport } | { kind: "missing" } | { kind: "error"; message: string };

/** Public, read-only report at /r/<token>. No auth. */
export function SharedReport({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const { config } = useConfig();

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
              <Link className="btn p" href={ROUTES.home}>
                What is Ensemblis?
              </Link>
            </div>
          }
        >
          The owner may have stopped sharing this result, or the link is incomplete. Ask them for a fresh link.
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
  const exec = r.kind === "execution";
  const title = exec ? r.title : reportTitle(r.result) || r.title;
  const team = r.team ?? [];
  const lead = r.leadAgent;
  const names = team.length ? team.map((t) => t.agentName) : lead ? [lead.name] : [];
  const unique = Array.from(new Set(names));
  const byCriterion = new Map((r.objective?.measurements ?? []).map((m) => [m.criterionId, m]));

  return (
    <>
      <div className="wrap" style={{ paddingTop: 22 }} data-testid="shared-report">
        <div className={S.bar}>
          <Link href={ROUTES.home} className={S.brand}>
            <Mark size={22} />
            <span>
              Shared {exec ? "result" : "report"} · made with <b>Ensemblis</b>
            </span>
          </Link>
          <ExportMenu
            title={title}
            markdown={r.result}
            sources={r.sources}
            meta={{ date: r.completedAt, depth: r.depth, agent: lead?.name ?? null, version: r.version, label: exec ? "Shared result" : "Shared report" }}
          />
        </div>

        <header className={S.head}>
          <div className="row wrapflex" style={{ gap: 8 }}>
            {exec ? (
              <>
                <span className="tag">Objective</span>
                {r.objective?.outcomeStatus && <OutcomeTag outcome={r.objective.outcomeStatus} />}
                {r.verification && <VerificationTag status={r.verification.status} score={r.verification.score} />}
              </>
            ) : (
              <>
                {r.category && <span className="tag">{r.category}</span>}
                <span className="tag gray">{r.depth.charAt(0).toUpperCase() + r.depth.slice(1)} depth</span>
                {r.version > 1 && <span className="tag gray">Version {r.version}</span>}
              </>
            )}
            {r.sources?.length > 0 && <span className="tag gray">{plural(r.sources.length, "source")}</span>}
            {exec && config.mockAI && (
              <span className="tag warn" title="This server runs the mock AI provider: the content is placeholder output for development and testing.">
                Mock AI — test output
              </span>
            )}
          </div>
          <h1>{title}</h1>
          <div className={S.byline}>
            {!exec && unique.length > 0 && (
              <span className={S.stack} aria-hidden="true">
                {unique.slice(0, 4).map((n) => (
                  <Avatar key={n} name={n} hue={lead && lead.name === n ? lead.hue : undefined} size="xs" />
                ))}
              </span>
            )}
            <span>
              {exec
                ? "Planned by a Chief of Staff, executed by an AI Team and checked against evidence"
                : unique.length > 1
                  ? `Produced by a team of ${unique.length} AI specialists`
                  : "Produced by an AI specialist"}
            </span>
            {r.completedAt && <span>· {longDate(r.completedAt)}</span>}
          </div>
        </header>

        {exec && r.objective && r.objective.criteria.length > 0 && (
          <section className="card tight" style={{ marginBottom: 20 }} aria-labelledby="sr-outcome">
            <div className="row between wrapflex" style={{ gap: 8 }}>
              <h3 id="sr-outcome" style={{ margin: 0 }}>
                Success criteria
              </h3>
              {r.objective.outcomeStatus && <OutcomeTag outcome={r.objective.outcomeStatus} />}
            </div>
            {r.objective.outcomeSummary && <p className="small muted" style={{ marginTop: 6 }}>{r.objective.outcomeSummary}</p>}
            <div className="crit" style={{ marginTop: 12 }}>
              {r.objective.criteria.map((c, i) => {
                const m = byCriterion.get(c.id);
                return (
                  <div className="row2" key={c.id}>
                    <span className="n">{i + 1}</span>
                    <div>
                      <div className="small" style={{ fontWeight: 600 }}>
                        {c.description}
                      </div>
                      {m && (
                        <div className="tiny muted" style={{ marginTop: 3 }}>
                          {m.measurement}
                          {m.explanation ? ` — ${m.explanation}` : ""}
                        </div>
                      )}
                    </div>
                    {m ? <CriterionTag result={m.result} /> : <span className="tiny muted">—</span>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <ReportView markdown={r.result} sources={r.sources} idPrefix="s" tocExtra={[{ id: "about", label: exec ? "How this was verified" : "How this was made" }]}>
          <section id="about" className="card" style={{ marginTop: 20, scrollMarginTop: 84 }} aria-labelledby="about-h">
            {exec ? (
              <>
                <h3 id="about-h">How this result was produced and verified</h3>
                <p className="small muted" style={{ marginTop: 4, maxWidth: "62ch" }}>
                  Someone defined a business objective with success criteria. The Chief of Staff planned it and assigned the work to the AI Team below. Every
                  claim was then checked against the numbered evidence, and each success criterion was assessed.
                </p>
                {r.verification && (
                  <div style={{ marginTop: 14 }}>
                    <div className="row wrapflex" style={{ gap: 8 }}>
                      <VerificationTag status={r.verification.status} score={r.verification.score} />
                      <span className="small">{r.verification.summary}</span>
                    </div>
                    {r.verification.checks.length > 0 && (
                      <div className="vchecks" style={{ marginTop: 10 }}>
                        {r.verification.checks.map((c) => (
                          <div className="vcheck" key={c.key}>
                            <span className={`ic ${c.status}`} aria-hidden="true">
                              {c.status === "pass" ? "✓" : c.status === "fail" ? "✕" : c.status === "warn" ? "!" : "–"}
                            </span>
                            <div>
                              <b className="small">{c.label}</b>
                              <div className="tiny muted">{c.detail}</div>
                            </div>
                            <span className="tiny muted" style={{ textAlign: "right" }}>
                              {c.score === null ? "—" : c.score}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {r.verification.warnings.length > 0 && (
                      <ul className="tiny muted" style={{ marginTop: 10, paddingLeft: 18 }}>
                        {r.verification.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {team.length > 0 && (
                  <ol className={S.team}>
                    {team.map((m, i) => (
                      <li key={`${m.agentName}-${i}`}>
                        <span className="tiny muted" style={{ width: 22, fontWeight: 700 }}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <ExecBadge executive={m.role} size={26} />
                        <div className="sp" style={{ minWidth: 0 }}>
                          <b className="small">{m.agentName}</b>
                          <div className="tiny muted">{m.title}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <>
                <h3 id="about-h">How this report was made</h3>
                <p className="small muted" style={{ marginTop: 4, maxWidth: "62ch" }}>
                  This report was produced by an earlier version of Ensemblis: a sequence of AI specialists, each handing its work to the next, with the final
                  report citing the numbered sources they gathered.
                </p>
                {team.length > 0 && (
                  <ol className={S.team}>
                    {team.map((m, i) => (
                      <li key={`${m.agentName}-${i}`}>
                        <span className="tiny muted" style={{ width: 22, fontWeight: 700 }}>
                          {String(i + 1).padStart(2, "0")}
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
              </>
            )}
            <p className="tiny muted" style={{ marginTop: 12 }}>
              Shared with a private link. Only this result is visible here — not the owner&apos;s account, company documents, costs or other work.
            </p>
          </section>
        </ReportView>
      </div>

      <section className={`dk cta-band ${S.cta}`} style={{ marginTop: 48 }}>
        <div className="wrap">
          <div className="eyebrow">MADE WITH ENSEMBLIS</div>
          <h2>Describe the outcome. We do the work.</h2>
          <p>Ensemblis turns a business objective into a plan, has an AI Team execute it, and verifies the result against evidence.</p>
          <div className="row wrapflex" style={{ marginTop: 26 }}>
            <Link className="btn p lg" href={ROUTES.home}>
              See how it works
              <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
