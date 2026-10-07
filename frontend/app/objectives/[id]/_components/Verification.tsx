"use client";

import type { Execution } from "@/lib/api";
import { ClaimTag, Icon, VerificationTag } from "@/components";

const MARK: Record<string, string> = { pass: "✓", warn: "!", fail: "×", not_assessed: "–" };

export function VerificationPanel({ execution }: { execution: Execution }) {
  const v = execution.verification;
  if (!v) {
    return (
      <p className="small muted">
        {execution.status === "VERIFYING"
          ? "Checking the result against the evidence and your success criteria…"
          : "The verification gate runs after the AI Team finishes. Nothing is presented as complete until it has run."}
      </p>
    );
  }
  const counts = v.claims.reduce<Record<string, number>>((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
  return (
    <div>
      <div className="card tight row between wrapflex" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 14 }}>
          <span className="score" aria-label={`Score ${v.score} out of 100`}>
            <b>{v.score}</b>
            <span className="muted small">/100</span>
          </span>
          <div>
            <VerificationTag status={v.status} />
            <div className="small" style={{ marginTop: 4 }}>
              {v.summary}
            </div>
          </div>
        </div>
        <span className="tiny muted">
          Round {v.round} · {v.method === "deterministic+model" ? "evidence checks + AI review" : "evidence checks only"} · {v.version}
        </span>
      </div>
      <div className="vchecks" style={{ marginTop: 12 }}>
        {v.checks.map((c) => (
          <div className="vcheck" key={c.key} data-testid="verification-check">
            <span className={`ic ${c.status}`} aria-label={c.status.replace("_", " ")}>
              {MARK[c.status]}
            </span>
            <div>
              <b>{c.label}</b>
              <div className="small muted">{c.detail}</div>
            </div>
            <span className="sc">{c.score ?? "—"}</span>
          </div>
        ))}
      </div>
      {v.humanJudgment.length > 0 && (
        <div className="banner-info" style={{ marginTop: 12 }}>
          <Icon name="user" size={15} />
          <div>
            <b className="small">Needs human judgment</b>
            <ul className="small" style={{ paddingLeft: 18, margin: "4px 0 0" }}>
              {v.humanJudgment.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {v.claims.length > 0 && (
        <details className="det" style={{ marginTop: 12 }}>
          <summary className="small">
            Claim checks: {counts.SUPPORTED ?? 0} supported by evidence
            {counts.PARTIALLY_SUPPORTED ? `, ${counts.PARTIALLY_SUPPORTED} partly` : ""}
            {counts.UNSUPPORTED ? `, ${counts.UNSUPPORTED} not found in evidence` : ""}
            {counts.UNCITED ? `, ${counts.UNCITED} uncited figures` : ""}
            {counts.ESTIMATE ? `, ${counts.ESTIMATE} estimates` : ""}
          </summary>
          <p className="tiny muted" style={{ margin: "8px 0" }}>
            “Supported” means the cited evidence contains the claim&apos;s figures and key terms (a text match) — not that an AI agreed with it.
          </p>
          <ul className="claims">
            {v.claims.map((c, i) => (
              <li key={i}>
                <div>
                  {c.claim}
                  {c.evidenceNs.length > 0 && <span className="muted"> {c.evidenceNs.map((n) => `[${n}]`).join("")}</span>}
                  <div className="tiny muted">{c.note}</div>
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
