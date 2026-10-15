"use client";

// Everything still open about this execution, in one place (lib/openIssues.ts): checks that
// failed or warned, claims the evidence doesn't support, criteria not met or not assessed,
// items that need human judgment, the plan's open questions, research that failed and why
// the result is not plainly verified. Each item links to the section that holds it.

import type { Execution, Objective } from "@/lib/api";
import { Icon, type IconName } from "@/components";
import { collectOpenIssues, groupOpenIssues, resultStateOf, type OpenIssueSeverity } from "@/lib/openIssues";

/** Items shown per group before "and N more". */
const SHOWN = 5;

const SEVERITY: Record<OpenIssueSeverity, { icon: IconName; text: string }> = {
  bad: { icon: "x", text: "Problem" },
  warn: { icon: "alert", text: "Warning" },
  info: { icon: "info", text: "Note" },
};

export function OpenIssuesCard({ objective, execution }: { objective: Objective; execution: Execution }) {
  const issues = collectOpenIssues({
    verification: execution.verification,
    measurements: execution.measurements,
    criteria: objective.criteria,
    plan: execution.plan,
    steps: execution.steps,
    resultState: resultStateOf(execution),
    resultReasons: execution.resultReasons ?? [],
    exceptions: execution.exceptions,
  });
  const groups = groupOpenIssues(issues);
  return (
    <section
      className={`cs-card cs-issues${issues.length ? "" : " is-clear"}`}
      id="open-issues"
      aria-labelledby="open-issues-h"
      data-testid="open-issues"
      data-count={issues.length}
    >
      <div className="cs-issues-head">
        <span className="cs-issues-ic" aria-hidden="true">
          <Icon name={issues.length ? "flag" : "check"} size={16} />
        </span>
        <h3 id="open-issues-h">
          Open issues <span className="cs-count">{issues.length}</span>
        </h3>
      </div>
      {issues.length === 0 ? (
        <p className="cs-issues-none">
          Nothing open: no check failed or warned, no claim is unsupported by its evidence, every success criterion is met and nothing is waiting for your judgment.
        </p>
      ) : (
        <>
          <p className="cs-issues-sub">What is unresolved in this result, and where to look. Recommended next action: resolve or accept each one before you rely on the report.</p>
          {groups.map((g) => (
            <div key={g.kind} className="cs-issues-g">
              <h4>{g.title}</h4>
              <ul>
                {g.items.slice(0, SHOWN).map((i, n) => (
                  <li key={n} className={`sev-${i.severity}`} data-testid="open-issue" data-kind={i.kind}>
                    <span className="cs-issue-ic" aria-hidden="true">
                      <Icon name={SEVERITY[i.severity].icon} size={12} />
                    </span>
                    <div className="cs-issue-b">
                      <a href={i.href} className="cs-issue-a">
                        <span className="sr-only">{SEVERITY[i.severity].text}: </span>
                        {i.title}
                      </a>
                      {i.detail && <p>{i.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
              {g.items.length > SHOWN && (
                <a href={g.items[0].href} className="cs-inline-link cs-issues-more">
                  and {g.items.length - SHOWN} more
                </a>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
