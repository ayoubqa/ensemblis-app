"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type ExceptionItem, type RiskLevel } from "@/lib/api";
import { EmptyState, Icon, PageHead, RequireAuth, SkeletonText, Tabs } from "@/components";
import { ExceptionCard } from "@/components/ops";
import { num, plural } from "@/lib/format";

export default function ExceptionsPage() {
  return (
    <RequireAuth>
      <ExceptionCenter />
    </RequireAuth>
  );
}

const SEVERITY_ORDER: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const KIND_GROUPS: { kind: ExceptionItem["kind"]; title: string; sub: string }[] = [
  { kind: "MISSING_INFORMATION", title: "Information needed", sub: "The Chief of Staff stopped instead of guessing." },
  { kind: "INSUFFICIENT_FUNDS", title: "Balance too low", sub: "The execution can't start until funds are added." },
  { kind: "POLICY_BLOCKED", title: "Blocked by policy", sub: "The action isn't allowed without a person." },
  { kind: "STEP_FAILED", title: "Failed steps", sub: "A step couldn't be completed." },
  { kind: "VERIFICATION_FAILED", title: "Verification failed", sub: "The result didn't pass its checks." },
];
const STATUS_GROUPS: { status: ExceptionItem["status"]; title: string }[] = [
  { status: "OPEN", title: "Open" },
  { status: "RESOLVED", title: "Resolved" },
  { status: "DISMISSED", title: "Dismissed" },
];

const KIND_SHORT: Record<ExceptionItem["kind"], string> = {
  MISSING_INFORMATION: "information needed",
  INSUFFICIENT_FUNDS: "balance too low",
  POLICY_BLOCKED: "blocked by policy",
  STEP_FAILED: "failed step",
  VERIFICATION_FAILED: "verification failed",
};

function ExceptionCenter() {
  const [tab, setTab] = useState<"OPEN" | "ALL">("OPEN");
  const [rows, setRows] = useState<ExceptionItem[] | null>(null);
  const load = useCallback(async () => setRows((await api.listExceptions(tab)).exceptions), [tab]);
  useEffect(() => {
    setRows(null);
    load().catch(() => setRows([]));
  }, [load]);

  const open = rows?.filter((x) => x.status === "OPEN") ?? [];
  const kinds = Array.from(new Set(open.map((x) => KIND_SHORT[x.kind])));
  const executions = new Set(open.map((x) => x.executionId)).size;

  const groups: { key: string; title: string; sub?: string; items: ExceptionItem[] }[] =
    tab === "OPEN"
      ? KIND_GROUPS.map((g) => ({
          key: g.kind,
          title: g.title,
          sub: g.sub,
          items: (rows ?? []).filter((x) => x.kind === g.kind).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || +new Date(b.createdAt) - +new Date(a.createdAt)),
        }))
      : STATUS_GROUPS.map((g) => ({
          key: g.status,
          title: g.title,
          items: (rows ?? []).filter((x) => x.status === g.status).sort((a, b) => +new Date(b.resolvedAt ?? b.createdAt) - +new Date(a.resolvedAt ?? a.createdAt)),
        }));
  const known = new Set(groups.flatMap((g) => g.items.map((x) => x.id)));
  const other = (rows ?? []).filter((x) => !known.has(x.id));
  if (other.length) groups.push({ key: "OTHER", title: "Other", items: other });
  const visible = groups.filter((g) => g.items.length);

  return (
    <div className="wrap op-page op-narrow">
      <PageHead
        eyebrow="Exception Center"
        title="Exceptions"
        sub="Routine work is handled automatically. When Ensemblis can't safely proceed, it stops and tells you what happened, why it matters, what it recommends and what it needs from you."
      />

      {tab === "OPEN" && rows !== null && (
        <div className={open.length ? "op-attn is-warn" : "op-attn is-clear"} role="status">
          <span className="op-ico" aria-hidden="true">
            <Icon name={open.length ? "alert" : "shield"} />
          </span>
          <div className="op-attn-main">
            <div className="op-attn-t">
              {open.length ? `${plural(executions, "execution")} ${executions === 1 ? "is" : "are"} waiting for you` : "Nothing needs you right now"}
            </div>
            <div className="op-attn-d">
              {open.length ? `${plural(open.length, "open exception")}: ${kinds.join(", ")}. The work stays paused until you respond.` : "Every execution is either progressing on its own or finished."}
            </div>
          </div>
        </div>
      )}

      <div className="op-center-tabs">
        <Tabs
          tabs={[
            { id: "OPEN", label: "Open", count: tab === "OPEN" ? rows?.length : undefined },
            { id: "ALL", label: "History" },
          ]}
          value={tab}
          onChange={(t) => setTab(t as "OPEN" | "ALL")}
          label="Exceptions"
        />
      </div>

      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {rows === null ? (
          <div className="op-panel op-pad" style={{ marginTop: 20 }}>
            <SkeletonText lines={4} />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ marginTop: 20 }}>
            <EmptyState icon="shield" title={tab === "OPEN" ? "No open exceptions" : "No exceptions yet"}>
              Missing information, failed steps, failed verification or a blocked start would appear here — and the execution waits for you.
            </EmptyState>
          </div>
        ) : (
          visible.map((g) => (
            <section key={g.key} className="op-group" aria-labelledby={`grp-${g.key}`}>
              <div className="op-group-head">
                <h2 id={`grp-${g.key}`}>{g.title}</h2>
                <span className={tab === "OPEN" ? "op-count is-warn" : "op-count"}>{num(g.items.length)}</span>
                {g.sub && <span className="op-meta">{g.sub}</span>}
              </div>
              <div className="op-stack">
                {g.items.map((x) => (
                  <ExceptionCard key={x.id} exception={x} onDone={load} showObjective />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
