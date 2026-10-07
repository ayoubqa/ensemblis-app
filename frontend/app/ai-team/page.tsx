"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { api, type AITeam, type CapabilityInfo, type ExecutiveInfo } from "@/lib/api";
import { Icon, PageHead, PageSkeleton, RequireAuth, Tag } from "@/components";
import { ExecBadge } from "@/components/ops";
import { eur } from "@/lib/format";
import { usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";

export default function AITeamPage() {
  return (
    <RequireAuth>
      <Team />
    </RequireAuth>
  );
}

function Capability({ c }: { c: CapabilityInfo }) {
  return (
    <details className="cap det">
      <summary>
        <span>
          <span className="nm">{c.name}</span>
          <span className="sp2"> · {c.specialist}</span>
        </span>
      </summary>
      <p className="small muted" style={{ marginTop: 6 }}>
        {c.description}
      </p>
      <ol className="small" style={{ paddingLeft: 18, marginTop: 6 }}>
        {c.methodology.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ol>
      <div className="row wrapflex" style={{ gap: 6, marginTop: 8 }}>
        {c.tools.map((t) => (
          <Tag key={t.key} variant="gray" title={`Permission: ${t.permission}`}>
            {t.name}
          </Tag>
        ))}
      </div>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        v{c.version} · {eur(c.costCents, { decimals: true })} per step · {c.completedLast30d} completed in 30 days
      </div>
    </details>
  );
}

function ExecutiveCard({ e, root = false }: { e: ExecutiveInfo; root?: boolean }) {
  return (
    <div className={root ? "exec root" : "exec"} data-testid="executive">
      <div className="ttl">
        <ExecBadge executive={e.key} size={34} />
        <div>
          <h3>{e.title}</h3>
          <div className="tiny muted">{e.department}</div>
        </div>
      </div>
      <p className="small" style={{ marginTop: 8 }}>
        {e.mandate}
      </p>
      {e.working.map((w, i) => (
        <Link key={i} href={ROUTES.objective(w.objectiveId)} className="working">
          <span className="pulse" aria-hidden="true" />
          <span>
            <b>{w.agent}</b>: {w.stepTitle} <span className="muted">· {w.objectiveTitle}</span>
          </span>
        </Link>
      ))}
      {e.capabilities.map((c) => (
        <Capability key={c.key} c={c} />
      ))}
    </div>
  );
}

function Team() {
  const [team, setTeam] = useState<AITeam | null>(null);
  const load = useCallback(async () => setTeam(await api.aiTeam()), []);
  usePolling(load, 20_000);
  if (!team) return <PageSkeleton cards={4} />;
  const cos = team.executives.find((e) => e.key === "chief_of_staff")!;
  const heads = team.executives.filter((e) => e.key !== "chief_of_staff");
  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <PageHead
        eyebrow="AI TEAM"
        title="Your AI organization"
        sub="The Chief of Staff plans every objective and assigns each step to the executive who owns the capability. Specialists do the work with the tools their playbook allows."
        actions={
          <Link href={ROUTES.newObjective} className="btn p">
            <Icon name="plus" />
            Delegate an outcome
          </Link>
        }
      />
      <div className="orgtree">
        <div className="orgroot">
          <ExecutiveCard e={cos} root />
        </div>
        <div className="orgbranches">
          {heads.map((e) => (
            <div key={e.key}>
              <ExecutiveCard e={e} />
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h2 className="sh">Permissions</h2>
        <div className="card tight">
          <p className="small">{team.policy.note}</p>
          <div className="row wrapflex" style={{ gap: 6, marginTop: 10 }}>
            {team.tools.map((t) => (
              <Tag key={t.key} variant="ok" title={t.description}>
                <Icon name="lock" size={12} /> {t.name} · {t.permission.replace("_", " ").toLowerCase()}
              </Tag>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Not granted: {team.policy.notGranted.map((p) => p.replace("_", " ").toLowerCase()).join(", ")}. Future capabilities that act outside Ensemblis will need an explicit grant and an approval for each action.
          </p>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            Every capability is versioned and code-reviewed (team registry {team.version}); each step records the version that ran. Verification costs {eur(team.verificationCostCents, { decimals: true })} per execution.
          </p>
        </div>
      </div>
    </div>
  );
}
