"use client";

import type { Execution, Objective, VerificationCheck, VerificationRound, VerificationStatus } from "@/lib/api";
import { ClaimTag, CriterionTag, Icon, VerificationTag } from "@/components";
import { ClaimTypeTag, providerName } from "@/components/Tags";
import { EvidenceChips } from "./Evidence";

const CHECK: Record<VerificationCheck["status"], { text: string; icon: "check" | "alert" | "x" | "info" }> = {
  pass: { text: "Passed", icon: "check" },
  warn: { text: "Warning", icon: "alert" },
  fail: { text: "Failed", icon: "x" },
  not_assessed: { text: "Not assessed", icon: "info" },
};

/** Score dial (decorative: the number is printed next to it). */
function ScoreDial({ score, status }: { score: number; status: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, score));
  return (
    <svg className={`cs-dial s-${status}`} width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r={r} className="cs-dial-bg" />
      {v > 0 && <circle cx="38" cy="38" r={r} className="cs-dial-fg" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 38 38)" />}
    </svg>
  );
}

const ROUND_VERDICT: Record<VerificationStatus, string> = {
  PASS: "passed",
  PASS_WITH_WARNINGS: "passed with warnings",
  FAIL: "failed",
  UNVERIFIED: "could not be verified",
};

/** "Round 1 failed (41/100) → revision → round 2 passed with warnings (78/100)". */
export function roundsLine(rounds: VerificationRound[], revised: boolean): string {
  return rounds
    .map((r, i) => {
      const score = r.status === "UNVERIFIED" ? "" : ` (${r.score}/100)`;
      const text = `${i === 0 ? "Round" : "round"} ${r.round} ${ROUND_VERDICT[r.status] ?? r.status.toLowerCase()}${score}`;
      if (i === 0) return text;
      const prev = rounds[i - 1];
      const between = prev.status === "FAIL" && revised ? "revision" : prev.status === "UNVERIFIED" ? "re-check" : null;
      return `${between ? `${between} → ` : ""}${text}`;
    })
    .join(" → ");
}

/** The verification gate: score, checks, per-criterion verdicts with their evidence, claim checks and earlier rounds. */
export function VerificationPanel({ execution, objective }: { execution: Execution; objective?: Objective }) {
  const v = execution.verification;
  if (!v) {
    return (
      <div className={`cs-card cs-gate-wait${execution.status === "VERIFYING" ? " is-live" : ""}`}>
        <span className="cs-gate-wait-ic" aria-hidden="true">
          <Icon name="shield" size={18} />
        </span>
        <p>
          {execution.status === "VERIFYING"
            ? "Checking the result against the evidence and your success criteria…"
            : execution.status === "COMPLETED"
              ? "No verification was recorded for this result, so it is not verified."
              : "Verification happens after the AI Team finishes. Nothing is presented as verified until it has passed."}
        </p>
      </div>
    );
  }
  const counts = v.claims.reduce<Record<string, number>>((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
  const unverified = v.status === "UNVERIFIED";
  const claimIssues = (counts.UNSUPPORTED ?? 0) + (counts.UNCITED ?? 0) > 0;
  const history = execution.verificationHistory ?? [];
  const revised = execution.steps.some((s) => s.kind === "revision" && s.status !== "SKIPPED");
  const criteria = v.criteria ?? [];
  const described = objective?.criteria ?? [];
  const model = v.modelProvider || v.modelName ? [providerName(v.modelProvider), v.modelName && v.modelName !== v.modelProvider ? v.modelName : null].filter(Boolean).join(" · ") : null;
  const how = unverified
    ? "evidence checks only — the AI review could not run"
    : v.method === "deterministic+model"
      ? `evidence checks + AI review${model ? ` (${model})` : ""}`
      : "evidence checks only";
  const parts = [
    `${counts.SUPPORTED ?? 0} supported by evidence`,
    counts.PARTIALLY_SUPPORTED ? `${counts.PARTIALLY_SUPPORTED} partly` : null,
    counts.UNSUPPORTED ? `${counts.UNSUPPORTED} not found in evidence` : null,
    counts.UNCITED ? `${counts.UNCITED} uncited ${counts.UNCITED === 1 ? "figure" : "figures"}` : null,
    counts.ESTIMATE ? `${counts.ESTIMATE} ${counts.ESTIMATE === 1 ? "estimate" : "estimates"}` : null,
  ].filter(Boolean);
  return (
    <div className="cs-card cs-gate">
      <div className="cs-gate-head">
        <div className="cs-gate-score">
          <ScoreDial score={unverified ? 0 : v.score} status={v.status} />
          <span className="cs-gate-num">
            {unverified ? (
              <b aria-label="No verification score">—</b>
            ) : (
              <>
                <b>{v.score}</b>
                <span>/100</span>
              </>
            )}
          </span>
        </div>
        <div className="cs-gate-tt">
          <VerificationTag status={v.status} />
          <p className="cs-gate-sum">{v.summary}</p>
          <p className="cs-gate-meta" title={v.version}>
            Verification round {v.round} · {how}
          </p>
        </div>
      </div>

      {unverified && (
        <div className="cs-empty is-warn cs-gate-unv" role="note">
          <Icon name="alert" size={16} />
          <p>
            <b>Not verified.</b> The AI review could not run{v.assessorError ? `: ${v.assessorError}` : "."} The evidence checks below ran; the success criteria
            were not assessed by AI, so nothing here confirms the result.
          </p>
        </div>
      )}

      {history.length > 1 && (
        <p className="cs-rounds" data-testid="verification-history">
          <Icon name="redo" size={13} />
          <span>{roundsLine(history, revised)}</span>
        </p>
      )}

      <ul className="cs-checks" aria-label="Verification checks">
        {v.checks.map((c) => (
          <li className={`cs-check s-${c.status}`} key={c.key} data-testid="verification-check">
            <span className="cs-check-ic" aria-hidden="true">
              <Icon name={CHECK[c.status].icon} size={13} />
            </span>
            <div className="cs-check-b">
              <p className="cs-check-l">
                <span className="sr-only">{CHECK[c.status].text}: </span>
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

      {criteria.length > 0 && (
        <div className="cs-vcrit" id="verification-criteria">
          <h3 className="cs-vcrit-h">
            Success criteria — AI verdicts <span className="cs-count">{criteria.length}</span>
          </h3>
          <ol className="cs-crit" aria-label="Success criteria verdicts">
            {criteria.map((c) => {
              const text = described[c.index - 1]?.description ?? null;
              const detail = [c.measurement, c.explanation].filter(Boolean).join(" — ");
              return (
                <li key={c.index} data-testid="criterion-assessment" data-status={c.status}>
                  <span className="cs-crit-n" aria-hidden="true">
                    {c.index}
                  </span>
                  <div className="cs-crit-b">
                    <p className="cs-crit-t">
                      <span className="sr-only">Criterion {c.index}: </span>
                      {text ?? `Criterion ${c.index}`}
                    </p>
                    {detail && <p className="cs-crit-m">{detail}</p>}
                    <p className="cs-crit-ev">
                      {c.evidence.length ? <EvidenceChips ns={c.evidence} label="Evidence" /> : <span className="cs-crit-noev">No evidence linked</span>}
                    </p>
                  </div>
                  <CriterionTag result={c.status} />
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {v.humanJudgment.length > 0 && (
        <div className="cs-callout">
          <Icon name="user" size={16} />
          <div>
            <p className="cs-callout-t">Needs human judgment</p>
            <ul>
              {v.humanJudgment.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {v.claims.length > 0 && (
        // Open from the start when some claim isn't supported by its evidence.
        <details className="cs-disc cs-claims" id="verification-claims" open={claimIssues}>
          <summary>
            Claim checks <span className="cs-disc-sub">{parts.join(" · ")}</span>
          </summary>
          <p className="cs-claims-note">
            “Supported” means the cited evidence contains the claim&apos;s figures and key terms (a text match) — not that an AI agreed with it.
          </p>
          <ul>
            {v.claims.map((c, i) => (
              <li key={i} className={`c-${c.status}`}>
                <div className="cs-claim-b">
                  <p>{c.claim}</p>
                  <div className="cs-claim-m">
                    {c.claimType && <ClaimTypeTag type={c.claimType} />}
                    <EvidenceChips ns={c.evidenceNs} label="Cites" />
                    {c.note && <span>{c.note}</span>}
                  </div>
                  {c.quote && (
                    <blockquote className="cs-claim-q">
                      <span className="sr-only">Supporting passage: </span>“{c.quote}”
                    </blockquote>
                  )}
                </div>
                <ClaimTag status={c.status} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
