"use client";

import type { Evidence, Execution } from "@/lib/api";
import { CUSTOM_SEARCH, researchNotice, usedCustomSearch } from "@/lib/openIssues";
import { Icon } from "@/components";
import { providerName } from "@/components/Tags";
import { EVIDENCE_KIND_LABEL, safeHref } from "@/components/report";
import { dateTime, longDate, relativeTime } from "@/lib/format";

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

const PROVIDED = new Set(["COMPANY_CONTEXT", "DOCUMENT"]);

/** "Provided by your organization", "via Tavily · “query” · retrieved 2h ago · published …". */
function provenance(e: Evidence): { parts: string[]; retrieved: string | null } {
  const parts: string[] = [];
  if (PROVIDED.has(e.kind) || e.retrieval === "provided" || e.retrieval === "upload") parts.push("Provided, not retrieved");
  else if (e.kind === "WEBSITE" || e.retrieval === "website") parts.push("Fetched from your company website");
  else if (e.provider) parts.push(`via ${providerName(e.provider)}${e.retrieval === "search_snippet" ? " search snippet" : ""}`);
  if (e.query) parts.push(`query “${e.query}”`);
  if (e.publishedAt) {
    const d = longDate(e.publishedAt);
    parts.push(`published ${d === "—" ? e.publishedAt : d}`);
  }
  return { parts, retrieved: e.retrievedAt ?? null };
}

export function EvidencePanel({ execution }: { execution: Execution }) {
  // This execution's web search went to TAVILY_BASE_URL (a stub or a proxy), as recorded with it — never
  // the server's current setting, so a later configuration change doesn't relabel an older execution.
  const customSearch = usedCustomSearch(execution);
  const foundBy = new Map(execution.steps.map((s) => [s.id, s.agent]));
  // Research can still happen after a blocked execution resumes, so it isn't "finished" here.
  const finished = ["COMPLETED", "FAILED", "CANCELLED", "VERIFYING"].includes(execution.status);
  const notice = researchNotice(execution.steps, execution.evidence, finished);
  const failedSearches = execution.steps.flatMap((s) => (s.status === "SKIPPED" ? [] : (s.research?.attempts ?? []).filter((a) => !a.ok).map((a) => ({ ...a, step: s.title }))));
  const extras = (
    <>
      {customSearch && (
        <div className="cs-empty is-warn cs-ev-notice" role="note" data-testid="search-endpoint-notice">
          <Icon name="alert" size={16} />
          <p>
            <b>{CUSTOM_SEARCH.head}</b> — {CUSTOM_SEARCH.text}
          </p>
        </div>
      )}
      {notice && (
        <div className={`cs-empty${notice.tone === "warn" ? " is-warn" : ""} cs-ev-notice`} role="note" data-testid="research-notice">
          <Icon name={notice.tone === "warn" ? "alert" : "info"} size={16} />
          <p>{notice.text}</p>
        </div>
      )}
      {failedSearches.length > 0 && (
        <details className="cs-disc cs-ev-failed" data-testid="failed-searches">
          <summary>
            Searches that failed <span className="cs-count">{failedSearches.length}</span>
          </summary>
          <ul>
            {failedSearches.map((a, i) => (
              <li key={i}>
                <b>{providerName(a.provider)}</b> · “{a.query}” — {[a.httpStatus ? `HTTP ${a.httpStatus}` : null, a.error].filter(Boolean).join(": ") || "failed"}
                <span className="cs-disc-why"> ({a.step})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
  if (!execution.evidence.length) {
    return (
      <>
        {extras}
        <div className="cs-empty">
          <Icon name="link" size={16} />
          <p>No evidence yet. Sources, documents and company context the AI Team uses appear here, numbered as they are cited.</p>
        </div>
      </>
    );
  }
  return (
    <>
      {extras}
      <div className="cs-card cs-ev-card">
        <ol className="cs-ev" data-testid="evidence-list">
          {execution.evidence.map((e) => {
            const href = safeHref(e.url);
            const who = e.stepId ? foundBy.get(e.stepId) : null;
            const meta = provenance(e);
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
                  {(meta.parts.length > 0 || meta.retrieved) && (
                    <p className="cs-ev-meta" data-testid="evidence-meta">
                      {meta.parts.map((p) => (
                        <span key={p}>{p}</span>
                      ))}
                      {meta.retrieved && (
                        <span>
                          retrieved{" "}
                          <time dateTime={meta.retrieved} title={dateTime(meta.retrieved)}>
                            {relativeTime(meta.retrieved)}
                          </time>
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
