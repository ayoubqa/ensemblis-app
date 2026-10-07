"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Autonomy, type Frequency, type Workflow } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { eur, relativeTime, shortDate } from "@/lib/format";
import { FREQ_PER } from "@/lib/data";
import { ROUTES } from "@/lib/routes";
import { EmptyState, Icon, PageHead, RequireAuth, SkeletonText, Tag, useToast } from "@/components";

export default function RoutinesPage() {
  return (
    <RequireAuth>
      <Routines />
    </RequireAuth>
  );
}

const FREQS: Frequency[] = ["Weekly", "Monthly", "Quarterly"];

function Routines() {
  const toast = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<Workflow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", basedOnText: "", frequency: "Weekly" as Frequency, criteria: "", budget: 20, autonomy: "AUTO_WITHIN_BUDGET" as Autonomy });
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => setRows((await api.listWorkflows()).workflows), []);
  useEffect(() => {
    load().catch(() => setRows([]));
  }, [load]);

  const create = async () => {
    setBusy("create");
    try {
      await api.createWorkflow({
        name: form.name.trim(),
        basedOnText: form.basedOnText.trim(),
        frequency: form.frequency,
        successCriteria: form.criteria.split("\n").map((s) => s.trim()).filter((s) => s.length >= 3),
        budgetCents: Math.round(form.budget * 100),
        autonomy: form.autonomy,
      });
      setCreating(false);
      setForm({ ...form, name: "", basedOnText: "", criteria: "" });
      toast("Recurring objective created");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const run = async (w: Workflow) => {
    setBusy(w.id);
    try {
      const r = await api.runWorkflow(w.id);
      toast("This period's objective was sent to the Chief of Staff");
      window.location.assign(ROUTES.objective(r.objectiveId));
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };
  const toggle = async (w: Workflow) => {
    try {
      await api.updateWorkflow(w.id, { isActive: !w.isActive });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const remove = async (w: Workflow) => {
    if (!window.confirm(`Delete “${w.name}”? Past objectives are kept.`)) return;
    try {
      await api.deleteWorkflow(w.id);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (user?.isGuest) {
    return (
      <div className="narrow" style={{ padding: "48px 24px" }}>
        <EmptyState icon="redo" title="Create a free account to set up recurring objectives" action={{ label: "Save your work", href: `${ROUTES.signup}?claim=1` }}>
          Recurring objectives run on a schedule — e.g. a weekly pipeline briefing — and are planned, executed and verified like any objective.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="narrow" style={{ maxWidth: 940, paddingBottom: 48 }}>
      <PageHead
        eyebrow="RECURRING OBJECTIVES"
        title="Recurring objectives"
        sub="Outcomes you need on a schedule. Each period Ensemblis creates a new objective that the Chief of Staff plans, the AI Team executes and the verifier checks — with the same approvals and budgets."
        actions={
          <button type="button" className="btn p" onClick={() => setCreating((c) => !c)}>
            <Icon name="plus" />
            New recurring objective
          </button>
        }
      />
      {creating && (
        <div className="card" style={{ marginBottom: 18 }}>
          <label className="l" htmlFor="r-name">Name</label>
          <input id="r-name" className="f" value={form.name} maxLength={120} placeholder="Weekly pipeline briefing" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label className="l" htmlFor="r-text" style={{ marginTop: 14 }}>Outcome to deliver each period</label>
          <textarea id="r-text" className="f" rows={3} value={form.basedOnText} placeholder="Produce a briefing on the sales opportunities most likely to close this month and what would move them forward." onChange={(e) => setForm({ ...form, basedOnText: e.target.value })} />
          <label className="l" htmlFor="r-crit" style={{ marginTop: 14 }}>Success criteria <span className="muted">(one per line, optional)</span></label>
          <textarea id="r-crit" className="f" rows={3} value={form.criteria} onChange={(e) => setForm({ ...form, criteria: e.target.value })} />
          <div className="field-grid" style={{ marginTop: 14 }}>
            <div>
              <label className="l" htmlFor="r-freq">Frequency</label>
              <select id="r-freq" className="f" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}>
                {FREQS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="l" htmlFor="r-budget">Budget per run (€)</label>
              <input id="r-budget" type="number" min={5} max={500} className="f" value={form.budget} onChange={(e) => setForm({ ...form, budget: Number(e.target.value) || 5 })} />
            </div>
          </div>
          <label className="l" style={{ marginTop: 14 }}>Autonomy</label>
          <div className="seg">
            <button type="button" className={form.autonomy === "AUTO_WITHIN_BUDGET" ? "on" : ""} onClick={() => setForm({ ...form, autonomy: "AUTO_WITHIN_BUDGET" })}>
              Run within budget
            </button>
            <button type="button" className={form.autonomy === "REVIEW_PLAN" ? "on" : ""} onClick={() => setForm({ ...form, autonomy: "REVIEW_PLAN" })}>
              Review each plan
            </button>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" className="btn p" onClick={create} disabled={!form.name.trim() || form.basedOnText.trim().length < 10 || !!busy} aria-busy={busy === "create"}>
              Create
            </button>
            <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {rows === null ? (
        <div className="card">
          <SkeletonText lines={4} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon="redo" title="No recurring objectives yet">
          For example: “Every Monday, produce a sales pipeline briefing.”
        </EmptyState>
      ) : (
        <div className="olist">
          {rows.map((w) => (
            <div key={w.id} className="orow" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <div style={{ minWidth: 0 }}>
                <div className="row wrapflex" style={{ gap: 8 }}>
                  <span className="t">{w.name}</span>
                  <Tag variant={w.isActive ? "ok" : "gray"}>{w.isActive ? `Every ${FREQ_PER[w.frequency]}` : "Paused"}</Tag>
                </div>
                <div className="s">{w.basedOnText}</div>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {w.runCount} run{w.runCount === 1 ? "" : "s"}
                  {w.lastRun ? ` · last ${relativeTime(w.lastRun)}` : ""}
                  {w.isActive && w.nextRun ? ` · next ${shortDate(w.nextRun)}` : ""}
                  {w.budgetCents ? ` · budget ${eur(w.budgetCents)}` : ""}
                  {w.lastObjectiveId && (
                    <>
                      {" · "}
                      <Link href={ROUTES.objective(w.lastObjectiveId)} style={{ color: "var(--accent)" }}>
                        latest objective
                      </Link>
                    </>
                  )}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn sm" onClick={() => run(w)} disabled={!!busy} aria-busy={busy === w.id}>
                  <Icon name="play" /> Run now
                </button>
                <button type="button" className="btn sm" onClick={() => toggle(w)}>
                  {w.isActive ? "Pause" : "Resume"}
                </button>
                <button type="button" className="ibtn" aria-label={`Delete ${w.name}`} onClick={() => remove(w)}>
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
