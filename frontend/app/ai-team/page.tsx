"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { api, type AITeam, type CapabilityInfo, type ExecutiveInfo, type ToolRef } from "@/lib/api";
import { EmptyState, Icon, PageHead, PageSkeleton, RequireAuth } from "@/components";
import { ExecBadge } from "@/components/ops";
import { errorText } from "@/lib/errors";
import { eur, num, plural } from "@/lib/format";
import { usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";

export default function AITeamPage() {
  return (
    <RequireAuth>
      <Team />
    </RequireAuth>
  );
}

const PERMISSION: Record<ToolRef["permission"], string> = {
  READ_ONLY: "Read-only",
  WRITE: "Write",
  EXTERNAL_ACTION: "External action",
  FINANCIAL: "Financial",
  DESTRUCTIVE: "Destructive",
};
const permissionLabel = (p: string) => PERMISSION[p as ToolRef["permission"]] ?? p.replace(/_/g, " ").toLowerCase();

const TRUST: Record<string, string> = {
  user_provided: "Provided by your organization",
  internal: "Kept by Ensemblis for your organization",
  untrusted: "Outside content — read as evidence, never as instructions",
};

const deptId = (e: ExecutiveInfo) => `exec-${e.key}`;

function Capability({ c }: { c: CapabilityInfo }) {
  const perms = Array.from(new Set(c.tools.map((t) => t.permission)));
  const shared = perms.length === 1 ? permissionLabel(perms[0]) : null;
  return (
    <article className="op-panel op-cap" aria-labelledby={`cap-${c.key}`}>
      <div className="op-cap-top">
        <div style={{ minWidth: 0 }}>
          <h3 id={`cap-${c.key}`}>{c.name}</h3>
          <span className="op-cap-who">
            <Icon name="user" />
            {c.specialist}
          </span>
        </div>
        <span className="op-ver" title="Capability version">
          <span className="sr-only">Version </span>v{c.version}
        </span>
      </div>
      <p className="op-cap-desc">{c.description}</p>
      {c.deliverable.length > 0 && (
        <div className="op-cap-sec">
          <span className="op-label">Produces</span>
          <ul className="op-produces">
            {c.deliverable.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {c.tools.length > 0 && (
        <div className="op-cap-sec">
          <span className="op-label">Allowed tools{shared ? ` · ${shared.toLowerCase()}` : ""}</span>
          <ul className="op-tools">
            {c.tools.map((t) => (
              <li key={t.key} className="op-tool">
                <Icon name="lock" />
                {t.name}
                {!shared && <span className="op-meta"> · {permissionLabel(t.permission)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="op-cap-foot">
        <details className="op-more">
          <summary>
            How it works
            <Icon name="down" />
          </summary>
          <div className="op-more-body">
            {c.methodology.length > 0 && (
              <div>
                <span className="op-label">Method</span>
                <ol>
                  {c.methodology.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ol>
              </div>
            )}
            {c.verificationFocus.length > 0 && (
              <div>
                <span className="op-label">Checked in verification</span>
                <ul>
                  {c.verificationFocus.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="op-meta">Each step using this capability is estimated at {eur(c.costCents, { decimals: true })} in the plan you approve.</p>
          </div>
        </details>
        <span className="op-meta">{plural(c.completedLast30d, "step")} completed in 30 days</span>
      </div>
    </article>
  );
}

function Department({ e, root = false }: { e: ExecutiveInfo; root?: boolean }) {
  return (
    <section id={deptId(e)} className="op-dept" aria-labelledby={`${deptId(e)}-h`} data-testid="executive">
      <div className="op-dept-head">
        <ExecBadge executive={e.key} size={40} />
        <div className="op-dept-b">
          <h2 id={`${deptId(e)}-h`}>{e.title}</h2>
          <div className="op-dept-line">
            <span>{e.department}</span>
            <span>{root ? "Leads the AI Team" : "Reports to the Chief of Staff"}</span>
            <span>{plural(e.capabilities.length, "capability", "capabilities")}</span>
          </div>
          <p className="op-dept-mandate">{e.mandate}</p>
        </div>
      </div>
      {e.working.length > 0 && (
        <ul className="op-working" aria-label={`${e.title}: work in progress`}>
          {e.working.map((w, i) => (
            <li key={`${w.objectiveId}-${i}`}>
              <Link href={ROUTES.objective(w.objectiveId)}>
                <span className="op-live">Executing</span>
                <span className="op-working-t">
                  <b>{w.agent}</b> — {w.stepTitle} <span className="op-meta">· {w.objectiveTitle}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ul className="op-caps">
        {e.capabilities.map((c) => (
          <li key={c.key}>
            <Capability c={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function OrgNode({ e, root = false }: { e: ExecutiveInfo; root?: boolean }) {
  return (
    <a href={`#${deptId(e)}`} className={root ? "op-node is-root" : "op-node"}>
      <ExecBadge executive={e.key} size={root ? 38 : 34} />
      <span className="op-node-b">
        <span className="op-node-t">{e.title}</span>
        <span className="op-node-d">{e.department}</span>
        <span className="op-node-f">
          <span>{plural(e.capabilities.length, "capability", "capabilities")}</span>
          {e.working.length > 0 && <span className="op-live">{num(e.working.length)} executing</span>}
        </span>
      </span>
    </a>
  );
}

function Team() {
  const [team, setTeam] = useState<AITeam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setTeam(await api.aiTeam());
      setError(null);
    } catch (e) {
      setError(errorText(e, "Couldn't load the AI Team."));
    }
  }, []);
  usePolling(load, 20_000);

  if (!team && error)
    return (
      <div className="wrap op-page">
        <PageHead eyebrow="AI Team" title="Your AI organization" />
        <EmptyState icon="alert" title="The AI Team couldn't be loaded" action={{ label: "Try again", onClick: () => void load() }}>
          {error}
        </EmptyState>
      </div>
    );
  if (!team) return <PageSkeleton cards={4} />;

  const cos = team.executives.find((e) => e.key === "chief_of_staff") ?? team.executives[0];
  const heads = team.executives.filter((e) => e !== cos);
  const capabilities = team.executives.reduce((n, e) => n + e.capabilities.length, 0);
  const working = team.executives.reduce((n, e) => n + e.working.length, 0);
  const granted = team.policy.granted.map(permissionLabel);

  return (
    <div className="wrap op-page">
      <PageHead
        eyebrow="AI Team"
        title="Your AI organization"
        sub="The Chief of Staff plans every objective and assigns each step to the executive who owns the capability. Specialists do the work with only the tools their capability allows."
        actions={
          <Link href={ROUTES.newObjective} className="btn p">
            <Icon name="plus" />
            Define an outcome
          </Link>
        }
      />

      <div className="op-glance" aria-label="AI Team at a glance">
        <div className="op-kpi">
          <span className="op-kpi-l">Departments</span>
          <span className="op-kpi-v">{num(heads.length)}</span>
          <span className="op-kpi-m">led by the Chief of Staff</span>
        </div>
        <div className="op-kpi">
          <span className="op-kpi-l">Capabilities</span>
          <span className="op-kpi-v">{num(capabilities)}</span>
          <span className="op-kpi-m">each versioned · registry {team.version}</span>
        </div>
        <div className={working ? "op-kpi is-accent" : "op-kpi"}>
          <span className="op-kpi-l">Executing now</span>
          <span className="op-kpi-v">{num(working)}</span>
          <span className="op-kpi-m">{working ? plural(working, "step") + " in progress" : "No step is executing right now"}</span>
        </div>
        <div className="op-kpi">
          <span className="op-kpi-l">Tool access</span>
          <span className="op-kpi-v">{granted.join(", ").replace(/-/g, " ") || "None"}</span>
          <span className="op-kpi-m">nothing is sent, published or spent</span>
        </div>
      </div>

      <section className="op-sec" aria-labelledby="h-org">
        <div className="op-sec-head">
          <div>
            <h2 id="h-org">Organization</h2>
            <p className="op-sec-sub">Who owns which work. Select an executive to see their capabilities.</p>
          </div>
        </div>
        <div className="op-org">
          <div className="op-org-root">
            <OrgNode e={cos} root />
          </div>
          <div className="op-org-stem" aria-hidden="true" />
          <ul className="op-org-branches" aria-label="Departments reporting to the Chief of Staff">
            {heads.map((e) => (
              <li key={e.key}>
                <OrgNode e={e} />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Department e={cos} root />
      {heads.map((e) => (
        <Department key={e.key} e={e} />
      ))}

      <section className="op-sec" aria-labelledby="h-guard" style={{ marginTop: 52 }}>
        <div className="op-sec-head">
          <div>
            <h2 id="h-guard">
              <Icon name="shield" />
              Permissions &amp; guardrails
            </h2>
            <p className="op-sec-sub">What the AI Team may touch. Every tool is granted explicitly; anything not listed here is not available to any capability.</p>
          </div>
        </div>
        <div className="op-panel op-guard">
          <div className="op-guard-a">
            <p>{team.policy.note}</p>
            {team.policy.notGranted.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <span className="op-label">Not granted</span>
                <ul className="op-denied">
                  {team.policy.notGranted.map((p) => (
                    <li key={p}>
                      <Icon name="x" />
                      {permissionLabel(p)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="op-note">
              Capability registry {team.version}. Every step records the capability version it used, and every execution is checked by an independent verification (
              {eur(team.verificationCostCents, { decimals: true })} per execution, included in plan estimates).
            </p>
          </div>
          <ul className="op-list" aria-label="Granted tools">
            {team.tools.map((t) => (
              <li key={t.key} className="op-toolrow">
                <div style={{ minWidth: 0 }}>
                  <b>{t.name}</b>
                  <p>{t.description}</p>
                  <p className="op-meta" style={{ marginTop: 4 }}>
                    {TRUST[t.trust] ?? t.trust} · v{t.version}
                  </p>
                </div>
                <span className="tag ok">
                  <Icon name="lock" />
                  {permissionLabel(t.permission)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
