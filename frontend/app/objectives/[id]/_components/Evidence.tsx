"use client";

import type { Execution } from "@/lib/api";

const KIND: Record<string, string> = {
  WEB: "Web",
  WIKIPEDIA: "Wikipedia",
  DOCUMENT: "Company document",
  COMPANY_CONTEXT: "Company context",
  WEBSITE: "Company website",
  CALCULATION: "Calculation",
  TOOL_OUTPUT: "Tool output",
  ARTIFACT: "Artifact",
};

export function EvidencePanel({ execution }: { execution: Execution }) {
  const stepTitle = new Map(execution.steps.map((s) => [s.id, `${s.agent}`]));
  if (!execution.evidence.length) {
    return <p className="small muted">No evidence yet. Sources, documents and company context the team uses appear here, numbered as they are cited.</p>;
  }
  return (
    <ul className="evlist" data-testid="evidence-list">
      {execution.evidence.map((e) => (
        <li key={e.id} id={`ev-${e.n}`}>
          <span className="evn">{e.n}</span>
          <div style={{ minWidth: 0 }}>
            <div className="k">
              {KIND[e.kind] ?? e.kind}
              {e.stepId && stepTitle.get(e.stepId) ? ` · found by ${stepTitle.get(e.stepId)}` : ""}
            </div>
            <div className="small" style={{ fontWeight: 600 }}>
              {e.url ? (
                <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" style={{ color: "var(--ink)" }}>
                  {e.title}
                </a>
              ) : (
                e.title
              )}
              {e.domain && <span className="muted" style={{ fontWeight: 400 }}> · {e.domain}</span>}
            </div>
            {e.snippet && <div className="x">{e.snippet}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
