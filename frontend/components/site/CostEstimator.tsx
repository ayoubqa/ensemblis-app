"use client";

import { useState } from "react";
import { useConfig } from "@/lib/config";
import { creditsNum } from "@/lib/format";
import { CAPABILITIES, EXAMPLE_PLAN, STEP_PRICES, TEAM_NAMES, VERIFICATION_CREDITS, WORK_STEPS, type Team } from "@/lib/offer";

// Estimate what a task will cost before signing up — built only from the public price list (lib/offer.ts),
// so it can't drift from what the planner charges. It estimates; the planner decides the actual steps and the
// plan shows its exact total before anything runs.

const WORK = CAPABILITIES.filter((c) => c.kind === "research" || c.kind === "analysis");
const TEAMS: Team[] = ["marketing", "sales", "finance", "operations", "chief_of_staff"];
const nameOf = (key: string) => CAPABILITIES.find((c) => c.key === key)?.name ?? key;
const priceOf = (key: string) => CAPABILITIES.find((c) => c.key === key)?.costCredits ?? 0;

/** Typical shapes of a task — illustrations of how plans are priced, not promises of what the planner will choose. */
const PRESETS: { key: string; label: string; steps: string[] }[] = [
  { key: "competitors", label: "Competitor scan", steps: ["competitor_analysis"] },
  { key: "outreach", label: "Outreach prep", steps: ["account_research", "lead_research"] },
  { key: "market-entry", label: "Market entry", steps: EXAMPLE_PLAN.map((s) => s.key).filter((k) => WORK.some((w) => w.key === k)) },
  { key: "pricing-change", label: "Pricing change", steps: ["unit_economics", "scenario_analysis", "competitor_analysis"] },
];

function coverage(starting: number, total: number): string {
  const n = Math.floor(starting / total);
  const balance = `A new account's ${creditsNum(starting)} starting credits`;
  if (n === 0) return `${balance} don't cover a task this size on their own.`;
  return `${balance} cover ${n === 1 ? "one task" : `${n} tasks`} of this size.`;
}

export function CostEstimator() {
  const { config, loaded } = useConfig();
  const [steps, setSteps] = useState<string[]>(PRESETS[2].steps);
  const full = steps.length >= WORK_STEPS.max;
  const total = STEP_PRICES.planning + steps.reduce((n, k) => n + priceOf(k), 0) + STEP_PRICES.synthesis + VERIFICATION_CREDITS;
  const starting = loaded ? config.startingCreditsCents : 0;
  const preset = PRESETS.find((p) => p.steps.length === steps.length && p.steps.every((k) => steps.includes(k)))?.key;

  const toggle = (key: string) => setSteps((s) => (s.includes(key) ? s.filter((k) => k !== key) : s.length >= WORK_STEPS.max ? s : [...s, key]));

  return (
    <div className="st-est">
      <div className="st-est-pick">
        <p className="st-est-q" id="est-presets">
          Start from a typical task
        </p>
        <div className="st-est-presets" role="group" aria-labelledby="est-presets">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className="st-est-preset" aria-pressed={preset === p.key} onClick={() => setSteps(p.steps)}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="st-est-q">…or choose the research and analysis it needs (up to {WORK_STEPS.max})</p>
        <div className="st-est-teams">
          {TEAMS.map((t) => {
            const caps = WORK.filter((c) => c.team === t);
            if (!caps.length) return null;
            return (
              <fieldset key={t}>
                <legend>{TEAM_NAMES[t]}</legend>
                {caps.map((c) => {
                  const on = steps.includes(c.key);
                  return (
                    <label key={c.key} className={on ? "on" : ""}>
                      <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(c.key)} />
                      <span>{c.name}</span>
                      <span className="st-est-c">{c.costCredits}</span>
                    </label>
                  );
                })}
              </fieldset>
            );
          })}
        </div>
      </div>

      <div className="st-est-out" aria-live="polite">
        <p className="st-lg-k">Estimate</p>
        <ol className="st-est-lines">
          <li>
            <span>Planning</span>
            <span>{STEP_PRICES.planning}</span>
          </li>
          {steps.length ? (
            steps.map((k) => (
              <li key={k}>
                <span>{nameOf(k)}</span>
                <span>{priceOf(k)}</span>
              </li>
            ))
          ) : (
            <li className="st-est-none">
              <span>Choose at least one research or analysis step</span>
              <span>—</span>
            </li>
          )}
          <li>
            <span>Synthesis</span>
            <span>{STEP_PRICES.synthesis}</span>
          </li>
          <li>
            <span>Verification</span>
            <span>{VERIFICATION_CREDITS}</span>
          </li>
        </ol>
        <p className="st-est-total">
          <span>About</span>
          <b data-testid="estimate-total">{creditsNum(total)}</b>
          <span>credits</span>
        </p>
        {starting > 0 && steps.length > 0 && <p className="st-est-bal">{coverage(starting, total)}</p>}
        <p className="st-est-note">
          An estimate from the price list. The planner decides the actual steps for your question, and the plan shows its exact total before
          anything runs — nothing is charged until you approve it.
        </p>
      </div>
    </div>
  );
}
