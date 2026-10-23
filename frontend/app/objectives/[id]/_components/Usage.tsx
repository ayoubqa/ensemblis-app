"use client";

// Every model call and web search metered for this execution — planning, search queries,
// steps, verification and memory — from its usage events. Token counts that are estimates
// are labelled as such, and the charge is a price, not what the provider billed.

import type { Execution, UsageByPurpose } from "@/lib/api";
import { providerName } from "@/components/Tags";
import { EstTag, latency } from "./Plan";

const PURPOSE: Record<string, string> = {
  plan: "Planning",
  queries: "Search queries",
  step: "Steps",
  verify: "Verification (AI review)",
  verify_claims: "Claim check",
  memory: "Memory",
  suggest: "Criteria suggestions",
  other: "Other",
};

const n = (x: number) => x.toLocaleString("en-US");

function Row({ g }: { g: UsageByPurpose }) {
  const time = latency(g.latencyMs);
  return (
    <li>
      <div className="cs-use-k">
        <b>{PURPOSE[g.purpose] ?? g.purpose}</b>
        <span>
          {providerName(g.provider)}
          {g.model && g.model !== g.provider ? ` · ${g.model}` : ""}
        </span>
      </div>
      <div className="cs-use-v">
        <span>
          {n(g.calls)} {g.calls === 1 ? "call" : "calls"}
          {g.failed > 0 && <em> · {n(g.failed)} failed</em>}
        </span>
        <span>
          {n(g.tokensIn)} in / {n(g.tokensOut)} out
          {g.estimated && <EstTag />}
        </span>
        {time && <span>{time}</span>}
      </div>
    </li>
  );
}

export function UsagePanel({ execution }: { execution: Execution }) {
  const u = execution.usage;
  if (!u) return null;
  const searches = u.searches.reduce((m, s) => m + s.calls, 0);
  const searchFailed = u.searches.reduce((m, s) => m + s.failed, 0);
  const time = latency(u.latencyMs);
  return (
    <div className="cs-card cs-use" data-testid="usage-panel">
      <dl className="cs-use-sum">
        <div>
          <dt>Model calls</dt>
          <dd>
            {n(u.calls)}
            {u.failedCalls > 0 && <small>{n(u.failedCalls)} failed</small>}
          </dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>
            {n(u.tokensIn)} in / {n(u.tokensOut)} out
            {u.estimated && <EstTag />}
          </dd>
        </div>
        {time && (
          <div>
            <dt>Model time</dt>
            <dd>{time}</dd>
          </div>
        )}
        <div>
          <dt>Web searches</dt>
          <dd>
            {n(searches)}
            {searches > 0 && (
              <small>
                {u.searches.map((s) => `${providerName(s.provider)} ${n(s.calls)}`).join(" · ")}
                {searchFailed > 0 ? ` · ${n(searchFailed)} failed` : ""}
              </small>
            )}
          </dd>
        </div>
      </dl>
      {u.byPurpose.length > 0 && (
        <ul className="cs-use-list" aria-label="Model usage by purpose">
          {u.byPurpose.map((g) => (
            <Row key={`${g.purpose}-${g.provider}-${g.model ?? ""}`} g={g} />
          ))}
        </ul>
      )}
      <p className="cs-use-note">
        What this execution was charged is Ensemblis&apos;s price for the work — not what the AI provider billed for these calls.
        {u.estimated ? " Counts marked ≈ est. are estimates (about 4 characters per token) or were not reported as measured by the provider." : ""}
      </p>
    </div>
  );
}
