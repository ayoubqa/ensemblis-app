"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Autonomy, type Frequency, type Workflow } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { eur, plural, relativeTime, shortDate } from "@/lib/format";
import { FREQ_PER } from "@/lib/data";
import { ROUTES } from "@/lib/routes";
import { EmptyState, Icon, PageHead, RequireAuth, Skeleton, Tag, useToast } from "@/components";

export default function RoutinesPage() {
  return (
    <RequireAuth>
      <Routines />
    </RequireAuth>
  );
}

const FREQS: Frequency[] = ["Weekly", "Monthly", "Quarterly"];
const MAX_CRITERIA = 6;
const MIN_BUDGET = 5;
const MAX_BUDGET = 500;

function Routines() {
  const toast = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const [rows, setRows] = useState<Workflow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", basedOnText: "", frequency: "Weekly" as Frequency, criteria: "", budget: 20, autonomy: "AUTO_WITHIN_BUDGET" as Autonomy });
  const [budgetText, setBudgetText] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => setRows((await api.listWorkflows()).workflows), []);
  const reload = useCallback(() => {
    setFailed(false);
    load().catch(() => setFailed(true));
  }, [load]);
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating]);

  const close = () => {
    setCreating(false);
    toggleRef.current?.focus();
  };

  const criteriaLines = form.criteria.split("\n").map((s) => s.trim()).filter((s) => s.length >= 3);
  const tooMany = criteriaLines.length > MAX_CRITERIA;
  const missing = !form.name.trim() ? "Give it a name." : form.basedOnText.trim().length < 10 ? "Describe the outcome (at least 10 characters)." : tooMany ? `Keep it to ${MAX_CRITERIA} success criteria.` : null;

  const create = async () => {
    setBusy("create");
    try {
      await api.createWorkflow({
        name: form.name.trim(),
        basedOnText: form.basedOnText.trim(),
        frequency: form.frequency,
        successCriteria: criteriaLines,
        budgetCents: Math.round(form.budget * 100),
        autonomy: form.autonomy,
      });
      setForm({ ...form, name: "", basedOnText: "", criteria: "" });
      close();
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
      router.push(ROUTES.objective(r.objectiveId));
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };
  const toggle = async (w: Workflow) => {
    setBusy(`${w.id}:toggle`);
    try {
      await api.updateWorkflow(w.id, { isActive: !w.isActive });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (w: Workflow) => {
    if (!window.confirm(`Delete “${w.name}”? Objectives it already created are kept.`)) return;
    try {
      await api.deleteWorkflow(w.id);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (user?.isGuest) {
    return (
      <div className="narrow ws-page ws-guest">
        <EmptyState icon="redo" title="Create a free account to set up recurring objectives" action={{ label: "Save your work", href: `${ROUTES.signup}?claim=1` }}>
          Recurring objectives repeat on a schedule — e.g. a weekly sales opportunity review — and are planned, executed and verified like any objective.
        </EmptyState>
      </div>
    );
  }

  const auto = form.autonomy === "AUTO_WITHIN_BUDGET";

  return (
    <div className="wrap ws-page ws-routines">
      <PageHead
        eyebrow="Recurring objectives"
        title="Recurring objectives"
        sub="Outcomes you need on a schedule. Each period Ensemblis creates a new objective that the Chief of Staff plans, the AI Team executes and Ensemblis verifies — with the same approvals and budgets."
        actions={
          <button ref={toggleRef} type="button" className={creating ? "btn" : "btn p"} onClick={() => (creating ? close() : setCreating(true))} aria-expanded={creating} aria-controls="ws-rform">
            <Icon name={creating ? "x" : "plus"} />
            {creating ? "Close" : "New recurring objective"}
          </button>
        }
      />

      {creating && (
        <section id="ws-rform" className="ws-panel ws-form ws-rform" aria-labelledby="ws-rform-h">
          <div className="ws-fs">
            <h2 className="ws-fs-title ws-rform-h" id="ws-rform-h">
              New recurring objective
            </h2>
            <div className="ws-rgrid">
              <div className="ws-rspan">
                <label className="l" htmlFor="r-name">
                  Name
                </label>
                <input id="r-name" ref={nameRef} className="f" value={form.name} maxLength={120} placeholder="e.g. Weekly sales opportunity review" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="ws-rspan">
                <label className="l" htmlFor="r-text">
                  Outcome to deliver each period
                </label>
                <textarea
                  id="r-text"
                  className="f"
                  rows={3}
                  value={form.basedOnText}
                  maxLength={4000}
                  placeholder="e.g. Rank the sales opportunities most likely to close this month and what would move each one forward."
                  onChange={(e) => setForm({ ...form, basedOnText: e.target.value })}
                />
              </div>
              <div className="ws-rspan">
                <label className="l" htmlFor="r-crit">
                  Success criteria <span className="ws-opt-l">(optional, one per line)</span>
                </label>
                <textarea id="r-crit" className="f" rows={3} value={form.criteria} placeholder={"e.g. Opportunities ranked by likelihood\nA next action for each"} onChange={(e) => setForm({ ...form, criteria: e.target.value })} aria-describedby="r-crit-hint" aria-invalid={tooMany || undefined} />
                <p className={tooMany ? "hint ws-bad" : "hint"} id="r-crit-hint">
                  {criteriaLines.length} of up to {MAX_CRITERIA}. Leave empty and the Chief of Staff proposes them each period.
                </p>
              </div>
              <div>
                <label className="l" htmlFor="r-freq">
                  Schedule
                </label>
                <select id="r-freq" className="f" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}>
                  {FREQS.map((f) => (
                    <option key={f} value={f}>
                      Every {FREQ_PER[f]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="l" htmlFor="r-budget">
                  Budget per objective
                </label>
                <div className="ws-money">
                  <span aria-hidden="true">€</span>
                  <input
                    id="r-budget"
                    type="number"
                    inputMode="numeric"
                    min={MIN_BUDGET}
                    max={MAX_BUDGET}
                    className="f"
                    value={budgetText ?? String(form.budget)}
                    onChange={(e) => {
                      setBudgetText(e.target.value);
                      const n = Math.round(Number(e.target.value));
                      if (e.target.value !== "" && n >= MIN_BUDGET && n <= MAX_BUDGET) setForm({ ...form, budget: n });
                    }}
                    onBlur={(e) => {
                      const n = Math.round(Number(e.target.value));
                      setForm({ ...form, budget: Number.isFinite(n) && n > 0 ? Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, n)) : MIN_BUDGET });
                      setBudgetText(null);
                    }}
                    aria-describedby="r-budget-hint"
                  />
                </div>
                <p className="hint" id="r-budget-hint">
                  In euros, €{MIN_BUDGET}–€{MAX_BUDGET}, for each period&apos;s objective.
                </p>
              </div>
              <div className="ws-rspan">
                <span className="l" id="r-auto-l">
                  Autonomy
                </span>
                <div className="ws-choice" role="radiogroup" aria-labelledby="r-auto-l">
                  <label className={auto ? "ws-choice-o on" : "ws-choice-o"}>
                    <input type="radio" name="r-autonomy" value="AUTO_WITHIN_BUDGET" checked={auto} onChange={() => setForm({ ...form, autonomy: "AUTO_WITHIN_BUDGET" })} />
                    <span>
                      <b>Start automatically within budget</b>
                      <span>Each period&apos;s objective starts on its own when its estimate is within budget; otherwise it asks you.</span>
                    </span>
                  </label>
                  <label className={!auto ? "ws-choice-o on" : "ws-choice-o"}>
                    <input type="radio" name="r-autonomy" value="REVIEW_PLAN" checked={!auto} onChange={() => setForm({ ...form, autonomy: "REVIEW_PLAN" })} />
                    <span>
                      <b>Review each plan first</b>
                      <span>You approve every period&apos;s plan and its cost before any work starts.</span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div className="ws-form-foot">
            <div className="ws-form-actions">
              <button type="button" className="btn p" onClick={create} disabled={!!missing || !!busy} aria-busy={busy === "create"} aria-describedby={missing ? "r-why" : undefined}>
                Create recurring objective
              </button>
              <button type="button" className="btn ghost" onClick={close}>
                Cancel
              </button>
            </div>
            {missing && (
              <p className="ws-why" id="r-why">
                {missing}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="ws-sec ws-sec-first" aria-label="Your recurring objectives">
        {failed ? (
          <EmptyState icon="alert" title="Recurring objectives couldn't be loaded" action={{ label: "Try again", onClick: reload, icon: "redo" }}>
            Something went wrong on our side. Nothing was changed.
          </EmptyState>
        ) : rows === null ? (
          <div className="ws-panel ws-quiet" aria-busy="true" aria-label="Loading">
            <div style={{ flex: 1 }}>
              <Skeleton height={14} width="40%" />
              <Skeleton height={11} width="70%" style={{ marginTop: 12 }} />
            </div>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="redo"
            title="No recurring objectives yet"
            action={!creating ? { label: "New recurring objective", onClick: () => setCreating(true), icon: "plus" } : undefined}
          >
            For example: “Every week, rank the sales opportunities most likely to close.”
          </EmptyState>
        ) : (
          <ul className="ws-routs">
            {rows.map((w) => (
              <li key={w.id} className="ws-panel ws-rout">
                <div className="ws-rout-main">
                  <div className="ws-rout-top">
                    <h2 className="ws-rout-t">{w.name}</h2>
                    <Tag variant={w.isActive ? "ok" : "gray"}>{w.isActive ? "Active" : "Paused"}</Tag>
                  </div>
                  <p className="ws-rout-s">{w.basedOnText}</p>
                  <dl className="ws-facts">
                    <div>
                      <dt>Schedule</dt>
                      <dd>Every {FREQ_PER[w.frequency]}</dd>
                    </div>
                    <div>
                      <dt>Next</dt>
                      <dd>{w.isActive && w.nextRun ? shortDate(w.nextRun) : "Paused"}</dd>
                    </div>
                    {w.budgetCents ? (
                      <div>
                        <dt>Budget</dt>
                        <dd>{eur(w.budgetCents)} each</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Created so far</dt>
                      <dd>
                        {plural(w.runCount, "objective")}
                        {w.lastRun ? `, last ${relativeTime(w.lastRun)}` : ""}
                      </dd>
                    </div>
                  </dl>
                  {w.lastObjectiveId && (
                    <Link href={ROUTES.objective(w.lastObjectiveId)} className="ws-link">
                      Latest objective <Icon name="arrow" size={14} />
                    </Link>
                  )}
                </div>
                <div className="ws-rout-actions">
                  <button type="button" className="btn sm" onClick={() => run(w)} disabled={!!busy} aria-busy={busy === w.id} aria-label={`Start this period's objective now: ${w.name}`}>
                    <Icon name="play" /> Start now
                  </button>
                  <button type="button" className="btn sm" onClick={() => toggle(w)} disabled={!!busy} aria-busy={busy === `${w.id}:toggle`} aria-label={`${w.isActive ? "Pause" : "Resume"} ${w.name}`}>
                    <Icon name={w.isActive ? "pause" : "redo"} /> {w.isActive ? "Pause" : "Resume"}
                  </button>
                  <button type="button" className="ibtn" aria-label={`Delete ${w.name}`} onClick={() => remove(w)} disabled={!!busy}>
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
