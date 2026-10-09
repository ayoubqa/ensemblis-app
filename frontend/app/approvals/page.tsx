"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Approval, type RiskLevel } from "@/lib/api";
import { EmptyState, Icon, PageHead, RequireAuth, SkeletonText, Tabs } from "@/components";
import { ApprovalCard } from "@/components/ops";
import { eur, num, plural } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

export default function ApprovalsPage() {
  return (
    <RequireAuth>
      <ApprovalCenter />
    </RequireAuth>
  );
}

const RISK_ORDER: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const RISK_LABEL: Record<RiskLevel, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

const PENDING_GROUPS: { kind: Approval["kind"]; title: string; sub: string }[] = [
  { kind: "ACTION", title: "External actions", sub: "Something outside Ensemblis would change." },
  { kind: "BUDGET", title: "Budget", sub: "Spending above your approval threshold." },
  { kind: "PLAN", title: "Plans to review", sub: "The Chief of Staff's plan, waiting before any work starts." },
];
const HISTORY_GROUPS: { status: Approval["status"]; title: string }[] = [
  { status: "PENDING", title: "Waiting for a decision" },
  { status: "APPROVED", title: "Approved" },
  { status: "REJECTED", title: "Rejected" },
  { status: "CANCELLED", title: "Withdrawn" },
];

const byRiskThenDate = (a: Approval, b: Approval) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || +new Date(b.createdAt) - +new Date(a.createdAt);

function ApprovalCenter() {
  const [tab, setTab] = useState<"PENDING" | "ALL">("PENDING");
  const [rows, setRows] = useState<Approval[] | null>(null);
  const load = useCallback(async () => setRows((await api.listApprovals(tab)).approvals), [tab]);
  useEffect(() => {
    setRows(null);
    load().catch(() => setRows([]));
  }, [load]);

  const pending = rows?.filter((a) => a.status === "PENDING") ?? [];
  const highest = pending.reduce<RiskLevel | null>((h, a) => (h === null || RISK_ORDER[a.risk] < RISK_ORDER[h] ? a.risk : h), null);
  const estimate = pending.reduce((n, a) => n + a.costCents, 0);

  const groups: { key: string; title: string; sub?: string; items: Approval[] }[] =
    tab === "PENDING"
      ? PENDING_GROUPS.map((g) => ({ key: g.kind, title: g.title, sub: g.sub, items: (rows ?? []).filter((a) => a.kind === g.kind).sort(byRiskThenDate) }))
      : HISTORY_GROUPS.map((g) => ({
          key: g.status,
          title: g.title,
          items: (rows ?? []).filter((a) => a.status === g.status).sort((a, b) => +new Date(b.decidedAt ?? b.createdAt) - +new Date(a.decidedAt ?? a.createdAt)),
        }));
  const known = new Set(groups.flatMap((g) => g.items.map((a) => a.id)));
  const other = (rows ?? []).filter((a) => !known.has(a.id));
  if (other.length) groups.push({ key: "OTHER", title: "Other", items: other });
  const visible = groups.filter((g) => g.items.length);

  return (
    <div className="wrap op-page op-narrow">
      <PageHead eyebrow="Approval Center" title="Approvals" sub="Plans and spending that need a person's authorization before the AI Team acts. Nothing is charged until you approve." />

      {tab === "PENDING" && rows !== null && (
        <div className={pending.length ? "op-attn is-warn" : "op-attn is-clear"} role="status">
          <span className="op-ico" aria-hidden="true">
            <Icon name={pending.length ? "alert" : "check"} />
          </span>
          <div className="op-attn-main">
            <div className="op-attn-t">{pending.length ? `${plural(pending.length, "decision")} waiting for you` : "Nothing is waiting for your approval"}</div>
            <div className="op-attn-d">
              {pending.length ? "Each one shows the plan, its estimated cost, its risk and a recommendation." : "When a plan or a spend needs your sign-off, it appears here and in the header."}
            </div>
          </div>
          {pending.length > 0 && (
            <div className="op-attn-stats">
              <div className="op-attn-stat">
                <b>{eur(estimate, { decimals: true })}</b>
                <span>estimated in total</span>
              </div>
              {highest && (
                <div className="op-attn-stat">
                  <b>{RISK_LABEL[highest]}</b>
                  <span>highest risk</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="op-center-tabs">
        <Tabs
          tabs={[
            { id: "PENDING", label: "Pending", count: tab === "PENDING" ? rows?.length : undefined },
            { id: "ALL", label: "History" },
          ]}
          value={tab}
          onChange={(t) => setTab(t as "PENDING" | "ALL")}
          label="Approvals"
        />
      </div>

      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {rows === null ? (
          <div className="op-panel op-pad" style={{ marginTop: 20 }}>
            <SkeletonText lines={4} />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ marginTop: 20 }}>
            <EmptyState icon="check" title={tab === "PENDING" ? "Nothing waiting for approval" : "No approvals yet"} action={tab === "PENDING" ? { label: "Define an outcome", href: ROUTES.newObjective } : undefined}>
              When the Chief of Staff plans an objective that needs your sign-off, it appears here with its cost, risk and a recommendation.
            </EmptyState>
          </div>
        ) : (
          visible.map((g) => (
            <section key={g.key} className="op-group" aria-labelledby={`grp-${g.key}`}>
              <div className="op-group-head">
                <h2 id={`grp-${g.key}`}>{g.title}</h2>
                <span className="op-count">{num(g.items.length)}</span>
                {g.sub && <span className="op-meta">{g.sub}</span>}
              </div>
              <div className="op-stack">
                {g.items.map((a) => (
                  <ApprovalCard key={a.id} approval={a} onDone={load} showObjective />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
