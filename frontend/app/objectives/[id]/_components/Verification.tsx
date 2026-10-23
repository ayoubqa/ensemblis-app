"use client";

import type { Execution, VerificationCheck } from "@/lib/api";
import { ClaimTag, Icon, VerificationTag } from "@/components";
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
      <circle cx="38" cy="38" r={r} className="cs-dial-fg" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 38 38)" />
    </svg>
  );
}

export function VerificationPanel({ execution }: { execution: Execution }) {
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
            : "Verification happens after the AI Team finishes. Nothing is presented as complete until it has been verified."}
        </p>
      </div>
    );
  }
  const counts = v.claims.reduce<Record<string, number>>((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
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
          <ScoreDial score={v.score} status={v.status} />
          <span className="cs-gate-num">
            <b>{v.score}</b>
            <span>/100</span>
          </span>
        </div>
        <div className="cs-gate-tt">
          <VerificationTag status={v.status} />
          <p className="cs-gate-sum">{v.summary}</p>
          <p className="cs-gate-meta" title={v.version}>
            Verification round {v.round} · {v.method === "deterministic+model" ? "evidence checks + AI review" : "evidence checks only"}
          </p>
        </div>
      </div>

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
        <details className="cs-disc cs-claims">
          <summary>
            Claim checks <span className="cs-disc-sub">{parts.join(" · ")}</span>
          </summary>
          <p className="cs-claims-note">
            “Supported” means the cited evidence contains the claim&apos;s figures and key terms (a text match) — not that an AI agreed with it.
          </p>
          <ul>
            {v.claims.map((c, i) => (
              <li key={i}>
                <div className="cs-claim-b">
                  <p>{c.claim}</p>
                  <div className="cs-claim-m">
                    <EvidenceChips ns={c.evidenceNs} label="Cites" />
                    {c.note && <span>{c.note}</span>}
                  </div>
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
