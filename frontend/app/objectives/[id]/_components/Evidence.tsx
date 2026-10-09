"use client";

import type { Execution } from "@/lib/api";
import { Icon } from "@/components";
import { EVIDENCE_KIND_LABEL, safeHref } from "@/components/report";

/** DOM id of an evidence item (citation [n] targets on the console). */
export const evidenceId = (n: number) => `ev-${n}`;

/** Scroll to an evidence item, focus it and flash it briefly. */
export function focusEvidence(n: number) {
  const el = document.getElementById(evidenceId(n));
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  el.focus({ preventScroll: true });
  el.classList.remove("cs-flash");
  void el.offsetWidth;
  el.classList.add("cs-flash");
  window.setTimeout(() => el.classList.remove("cs-flash"), 1900);
}

/** Citation-style chips that jump to evidence items. */
export function EvidenceChips({ ns, label = "Evidence" }: { ns: number[]; label?: string }) {
  if (!ns.length) return null;
  return (
    <span className="cs-evchips">
      <span className="cs-evchips-k">{label}</span>
      {ns.map((n) => (
        <a
          key={n}
          href={`#${evidenceId(n)}`}
          className="cs-evchip"
          aria-label={`Evidence ${n}`}
          onClick={(e) => {
            e.preventDefault();
            focusEvidence(n);
          }}
        >
          {n}
        </a>
      ))}
    </span>
  );
}

export function EvidencePanel({ execution }: { execution: Execution }) {
  const foundBy = new Map(execution.steps.map((s) => [s.id, s.agent]));
  if (!execution.evidence.length) {
    return (
      <div className="cs-empty">
        <Icon name="link" size={16} />
        <p>No evidence yet. Sources, documents and company context the AI Team uses appear here, numbered as they are cited.</p>
      </div>
    );
  }
  return (
    <div className="cs-card cs-ev-card">
      <ol className="cs-ev" data-testid="evidence-list">
        {execution.evidence.map((e) => {
          const href = safeHref(e.url);
          const who = e.stepId ? foundBy.get(e.stepId) : null;
          return (
            <li key={e.id} id={evidenceId(e.n)} tabIndex={-1}>
              <span className="cs-ev-n" aria-hidden="true">
                {e.n}
              </span>
              <div className="cs-ev-b">
                <div className="cs-ev-k">
                  <span className="sr-only">Evidence {e.n}: </span>
                  <span className="cs-kind">{EVIDENCE_KIND_LABEL[e.kind] ?? e.kind}</span>
                  {who && <span>Found by {who}</span>}
                </div>
                <p className="cs-ev-t">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                      {e.title}
                      <Icon name="ext" size={12} />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    e.title
                  )}
                  {e.domain && <span className="cs-ev-d"> · {e.domain}</span>}
                </p>
                {e.snippet && <p className="cs-ev-x">{e.snippet}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
