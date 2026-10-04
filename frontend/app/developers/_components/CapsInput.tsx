"use client";

import { useState } from "react";
import { Icon } from "@/components";

/** Suggested capabilities per category (prototype CAP list, broadened per category). */
export const CAP_SUGGESTIONS: Record<string, string[]> = {
  Research: ["Competitive research", "Company research", "Market analysis", "Data extraction", "Report writing", "Source verification"],
  Sales: ["Prospect search", "Lead qualification", "Contact enrichment", "Account research", "Buying signals"],
  Marketing: ["Campaign planning", "Audience research", "Content strategy", "SEO audit", "Editorial calendars"],
  Finance: ["Statement analysis", "Forecasting", "Variance review", "KPI reporting", "Pricing analysis"],
  Development: ["Security review", "Performance profiling", "Fix proposals", "Migration planning", "Test generation"],
  Operations: ["Process mapping", "Vendor comparison", "Runbook drafting", "Ticket triage"],
  Legal: ["Case law search", "Regulatory summary", "Citation checks", "Contract review"],
  Design: ["Storyline", "Slide design", "Speaker notes", "Brand review"],
  "Customer Support": ["Ticket triage", "Reply drafting", "Escalation rules", "Knowledge base answers"],
  Data: ["Data cleaning", "Statistical analysis", "Visualization", "Anomaly detection"],
  Product: ["Feedback synthesis", "Opportunity sizing", "Feature prioritization", "User research"],
  "Business Intelligence": ["Change tracking", "Pricing watch", "Alerting", "Competitor monitoring"],
};

export const suggestionsFor = (category: string) => CAP_SUGGESTIONS[category] ?? CAP_SUGGESTIONS.Research;

/** Toggle suggested capabilities as chips, or type your own (Enter / comma to add). */
export function CapsInput({
  id,
  value,
  onChange,
  category,
  max = 12,
  invalid,
}: {
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
  category: string;
  max?: number;
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const sugg = suggestionsFor(category);
  const all = [...sugg, ...value.filter((c) => !sugg.includes(c))];
  const has = (c: string) => value.some((x) => x.toLowerCase() === c.toLowerCase());
  const toggle = (c: string) => onChange(has(c) ? value.filter((x) => x.toLowerCase() !== c.toLowerCase()) : value.length >= max ? value : [...value, c]);
  const add = () => {
    const c = draft.trim().replace(/,$/, "").slice(0, 60);
    if (c && !has(c) && value.length < max) onChange([...value, c]);
    setDraft("");
  };
  return (
    <>
      <div className="row wrapflex" style={{ gap: 8 }} role="group" aria-label="Capabilities">
        {all.map((c) => {
          const on = has(c);
          return (
            <button key={c} type="button" className={on ? "chip on" : "chip"} aria-pressed={on} onClick={() => toggle(c)}>
              {on && <Icon name="check" />}
              {c}
            </button>
          );
        })}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <input
          id={id}
          className="f"
          placeholder={value.length >= max ? `Maximum ${max} capabilities` : "Add your own capability, then press Enter"}
          value={draft}
          disabled={value.length >= max}
          aria-invalid={invalid || undefined}
          maxLength={60}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(",")) {
              const parts = v.split(",");
              const rest = parts.pop() ?? "";
              const next = [...value];
              for (const p of parts) {
                const c = p.trim().slice(0, 60);
                if (c && !next.some((x) => x.toLowerCase() === c.toLowerCase()) && next.length < max) next.push(c);
              }
              onChange(next);
              setDraft(rest.trimStart());
            } else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
        />
        <button type="button" className="btn" onClick={add} disabled={!draft.trim()}>
          <Icon name="plus" />
          Add
        </button>
      </div>
      <p className="hint">
        {value.length} of {max} selected. Customers see the first three on your marketplace card.
      </p>
    </>
  );
}
