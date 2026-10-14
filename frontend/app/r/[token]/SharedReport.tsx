"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type PublicReport } from "@/lib/api";
import { CriterionTag, EmptyState, Icon, Mark, OutcomeTag, Skeleton, SkeletonText, VerificationTag, outcomeLabel, type IconName } from "@/components";
import { EXEC_LABEL, ExecBadge } from "@/components/ops";
import { AI_NOTE, ExportMenu, LEGACY_NOTE, ReportView, reportTitle } from "@/components/report";
import { longDate } from "@/lib/format";
import { useConfig } from "@/lib/config";
import { ROUTES } from "@/lib/routes";
import S from "./shared.module.css";

type State = { kind: "loading" } | { kind: "ok"; report: PublicReport } | { kind: "missing" } | { kind: "error"; message: string };

const CHECK_TEXT: Record<string, { text: string; icon: IconName }> = {
  pass: { text: "Passed", icon: "check" },
  warn: { text: "Warning", icon: "alert" },
  fail: { text: "Failed", icon: "x" },
  not_assessed: { text: "Not assessed", icon: "info" },
};

/** The lifecycle every shared result went through — described honestly, without the owner's private details. */
const LIFECYCLE: { label: string; text: string }[] = [
  { label: "Objective", text: "A business objective with success criteria." },
  { label: "Plan", text: "The Chief of Staff planned the steps and priced the work." },
  { label: "Approval", text: "Cleared to proceed by the owner, or within their pre-approved budget." },
  { label: "Execution", text: "The AI Team executed each step." },
  { label: "Verification", text: "Checked against the evidence and the success criteria." },
  { label: "Evidence", text: "Numbered sources, cited in the text as [n]." },
  { label: "Outcome", text: "Each success criterion measured." },
];

/** Public, read-only report at /r/<token>. No auth, never any amounts. */
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
      <div className={`narrow ${S.state}`}>
        <EmptyState
          icon="lock"
          titleAs="h1"
          title="This link isn't active"
          action={
            <Link className="btn p" href={ROUTES.howItWorksPage}>
              What is Ensemblis?
            </Link>
          }
        >
          The owner may have stopped sharing this result, or the link is incomplete. Ask them for a fresh link.
        </EmptyState>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={`narrow ${S.state}`}>
        <EmptyState
          icon="alert"
          titleAs="h1"
          title="Couldn't load this result"
          action={
            <button type="button" className="btn p" onClick={load}>
              Try again
            </button>
          }
        >
          {state.message}
        </EmptyState>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className={`wrap ${S.page}`} aria-busy="true" aria-label="Loading the shared result">
        <Skeleton height={52} radius={14} />
        <div className={S.cover}>
          <Skeleton width={160} height={14} />
          <Skeleton width="70%" height={44} style={{ marginTop: 18 }} />
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
  const v = exec ? r.verification ?? null : null;
  const verified = !!v && v.status !== "FAIL";
  const criteria = exec ? r.objective?.criteria ?? [] : [];
  const measurements = r.objective?.measurements ?? [];
  const byCriterion = new Map(measurements.map((m) => [m.criterionId, m]));
  const met = measurements.filter((m) => m.result === "MET").length;
  const outcome = exec ? r.objective?.outcomeStatus ?? null : null;
  const team = r.team ?? [];
  const sourceCount = r.sources?.length ?? 0;
  const kicker = !exec ? "Earlier report" : verified ? "Verified report" : "Report";

  return (
    <>
      <div className={`wrap ${S.page}`} data-testid="shared-report">
        <div className={S.bar}>
          <Link href={ROUTES.howItWorksPage} className={S.brand}>
            <Mark size={24} />
            <span className={S.brandName}>Ensemblis</span>
            <span className={S.brandSep} aria-hidden="true" />
            <span className={S.brandSub}>Shared {exec ? "result" : "report"}</span>
          </Link>
          <ExportMenu
            title={title}
            markdown={r.result}
            sources={r.sources}
            meta={
              exec
                ? { date: r.completedAt, label: verified ? "Verified report" : "Report", note: AI_NOTE }
                : { date: r.completedAt, label: "Earlier report", version: r.version, note: LEGACY_NOTE }
            }
          />
        </div>

        <header className={S.cover}>
          <p className={S.kicker}>
            <Icon name={exec && verified ? "shield" : "report"} size={14} />
            {kicker}
            {!exec && r.version > 1 && <span className={S.kickerSub}>Version {r.version}</span>}
          </p>
          <h1>{title}</h1>
          <p className={S.byline}>
            {exec ? "Planned by a Chief of Staff, executed by an AI Team and checked against evidence" : "Produced by an earlier version of Ensemblis"}
            {r.completedAt && (
              <>
                <span aria-hidden="true"> · </span>
                <time dateTime={r.completedAt}>{longDate(r.completedAt)}</time>
              </>
            )}
          </p>
          {exec && config.mockAI && (
            <p className={S.mock}>
              <span className="tag warn">Mock AI — test output</span>
              <span>Generated by the mock AI provider for development and testing — not real analysis.</span>
            </p>
          )}
          {exec ? (
            <dl className={S.facts}>
              {outcome && (
                <div>
                  <dt>Outcome</dt>
                  <dd>
                    <span className={`${S.dot} ${S[`o_${outcome}`] ?? ""}`} aria-hidden="true" />
                    {outcomeLabel(outcome)}
                  </dd>
                </div>
              )}
              {v && (
                <div>
                  <dt>Verification</dt>
                  <dd>
                    <span className={`${S.dot} ${S[`v_${v.status}`] ?? ""}`} aria-hidden="true" />
                    {v.score}
                    <small>/100</small>
                  </dd>
                </div>
              )}
              {criteria.length > 0 && (
                <div>
                  <dt>Success criteria</dt>
                  <dd>
                    {met}
                    <small> of {criteria.length} met</small>
                  </dd>
                </div>
              )}
              <div>
                <dt>Evidence</dt>
                <dd>
                  {sourceCount}
                  <small> {sourceCount === 1 ? "source" : "sources"}</small>
                </dd>
              </div>
            </dl>
          ) : (
            <p className={S.legacyNote}>
              <Icon name="info" size={15} />
              <span>This report predates objectives, approvals and verification, so it has no success criteria or verification score.</span>
            </p>
          )}
        </header>

        {exec && criteria.length > 0 && (
          <section className={`cs-card ${S.outcome}`} aria-labelledby="sr-outcome">
            <div className="cs-out-head">
              <span className={`cs-out-badge o-${outcome ?? "UNKNOWN"}`} aria-hidden="true">
                <Icon name={outcome === "ACHIEVED" ? "check" : outcome === "NOT_ACHIEVED" ? "x" : outcome === "PARTIALLY_ACHIEVED" ? "flag" : "target"} size={20} />
              </span>
              <div className="cs-out-tt">
                <h2 id="sr-outcome" className={S.h2}>
                  Success criteria
                </h2>
                {r.objective?.outcomeSummary && <p className="cs-out-sum">{r.objective.outcomeSummary}</p>}
              </div>
              {outcome && <OutcomeTag outcome={outcome} />}
            </div>
            <ol className="cs-crit" aria-label="Success criteria results">
              {criteria.map((c, i) => {
                const m = byCriterion.get(c.id);
                return (
                  <li key={c.id}>
                    <span className="cs-crit-n" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="cs-crit-b">
                      <p className="cs-crit-t">{c.description}</p>
                      {m && (
                        <p className="cs-crit-m">
                          {m.measurement}
                          {m.explanation ? ` — ${m.explanation}` : ""}
                        </p>
                      )}
                    </div>
                    {m ? <CriterionTag result={m.result} /> : <span className="cs-crit-none">Not measured</span>}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <ReportView
          markdown={r.result}
          sources={r.sources}
          idPrefix="s"
          className={S.reader}
          disclaimer={exec ? AI_NOTE : LEGACY_NOTE}
          sourcesNote={exec ? undefined : "The sources gathered when this report was made. Open them to check a claim before you rely on it."}
          tocExtra={[{ id: "about", label: exec ? (verified ? "How this was verified" : "How this was produced") : "About this report" }]}
        >
          <section id="about" className={`cs-card ${S.about}`} aria-labelledby="about-h">
            {exec ? (
              <>
                <h2 id="about-h" className={S.h2}>
                  {verified ? "How this result was produced and verified" : "How this result was produced"}
                </h2>
                <p className={S.lead}>
                  Someone defined a business objective with success criteria. The Chief of Staff planned it and the AI Team executed it. Statements that cite
                  evidence or give figures were then checked against the numbered sources (a text match), and each success criterion was assessed.
                </p>
                <ol className={S.life} aria-label="How the result was produced">
                  {LIFECYCLE.map((s, i) => (
                    <li key={s.label}>
                      <span className={S.lifeN} aria-hidden="true">
                        {i + 1}
                      </span>
                      <b>{s.label}</b>
                      <span>{s.text}</span>
                    </li>
                  ))}
                </ol>

                {v && (
                  <div className={S.verify}>
                    <div className={S.verifyHead}>
                      <h3 className={S.h3}>Verification</h3>
                      <VerificationTag status={v.status} score={v.score} />
                    </div>
                    <p className={S.verifySum}>{v.summary}</p>
                    {v.status === "FAIL" && <p className={S.verifyWarn}>This result did not pass verification. The owner chose to accept it with its warnings.</p>}
                    {v.checks.length > 0 && (
                      <ul className="cs-checks" aria-label="Verification checks">
                        {v.checks.map((c) => (
                          <li className={`cs-check s-${c.status}`} key={c.key}>
                            <span className="cs-check-ic" aria-hidden="true">
                              <Icon name={CHECK_TEXT[c.status]?.icon ?? "info"} size={13} />
                            </span>
                            <div className="cs-check-b">
                              <p className="cs-check-l">
                                <span className="sr-only">{CHECK_TEXT[c.status]?.text ?? c.status}: </span>
                                {c.label}
                              </p>
                              <p className="cs-check-d">{c.detail}</p>
                            </div>
                            <div className="cs-check-s">
                              {c.score !== null && (
                                <span className="cs-meter" aria-hidden="true">
                                  <i style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }} />
                                </span>
                              )}
                              <b>
                                {c.score ?? "—"}
                                {c.score !== null && <span className="sr-only"> out of 100</span>}
                              </b>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {v.warnings.length > 0 && (
                      <ul className={S.warnings}>
                        {v.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {team.length > 0 && (
                  <div className={S.teamWrap}>
                    <h3 className={S.h3}>The AI Team</h3>
                    <ol className={S.team}>
                      {team.map((m, i) => (
                        <li key={`${m.agentName}-${i}`}>
                          <span className={S.teamN} aria-hidden="true">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <ExecBadge executive={m.role} size={28} />
                          <div className={S.teamB}>
                            <b>{m.agentName}</b>
                            <span>
                              {EXEC_LABEL[m.role] ? `${EXEC_LABEL[m.role]} · ` : ""}
                              {m.title}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 id="about-h" className={S.h2}>
                  About this report
                </h2>
                <p className={S.lead}>
                  This report was produced by an earlier version of Ensemblis, before objectives, approvals and verification existed. It cites the numbered
                  sources gathered at the time.
                </p>
              </>
            )}
            <p className={S.private}>
              <Icon name="lock" size={14} />
              <span>Shared with a private link. Only this result is visible here — not the owner&apos;s account, company documents, costs or other work.</span>
            </p>
          </section>
        </ReportView>
      </div>

      <section className={`dk ${S.cta}`} aria-labelledby="sr-cta-h">
        <div className="wrap">
          <p className={S.ctaEyebrow}>
            <Mark size={20} />
            Made with Ensemblis
          </p>
          <h2 id="sr-cta-h">Describe the outcome. We do the work.</h2>
          <p className={S.ctaText}>
            Ensemblis turns a business objective into a plan, has an AI Team execute it, and verifies the result against evidence and your success criteria.
          </p>
          <div className={S.ctaBtns}>
            <Link className="btn p lg" href={ROUTES.howItWorksPage}>
              See how it works
              <Icon name="arrow" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
