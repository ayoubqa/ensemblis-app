"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, type Autonomy, type ContextPayload, type Organization } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { EXAMPLE_OBJECTIVES } from "@/lib/data";
import { eur } from "@/lib/format";
import { useLocalStorage } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { CharCount, Icon, RequireAuth, useToast } from "@/components";

export default function NewObjectivePage() {
  return (
    <RequireAuth>
      <Suspense>
        <DefineOutcome />
      </Suspense>
    </RequireAuth>
  );
}

const DRAFT_KEY = "ensemblis_objective_draft";

function DefineOutcome() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { config } = useConfig();
  const [draft, setDraft] = useLocalStorage<{ statement: string; criteria: string[]; notes: string }>(DRAFT_KEY, { statement: "", criteria: [], notes: "" });
  const [statement, setStatement] = useState("");
  const [criteria, setCriteria] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [deadline, setDeadline] = useState("");
  const [budget, setBudget] = useState<number | null>(null);
  const [autonomy, setAutonomy] = useState<Autonomy>("REVIEW_PLAN");
  const [org, setOrg] = useState<Organization | null>(null);
  const [ctx, setCtx] = useState<ContextPayload | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedTitle, setSuggestedTitle] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [busy, setBusy] = useState<"plan" | "draft" | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    api.getOrg().then(({ organization }) => {
      setOrg(organization);
      setAutonomy(organization.defaultAutonomy);
      setBudget((b) => b ?? Math.max(500, organization.approvalThresholdCents));
    }).catch(() => undefined);
    api.getContext().then(setCtx).catch(() => undefined);
  }, []);

  // Restore an unsent draft once (or apply ?example=n).
  useEffect(() => {
    if (restored) return;
    const ex = Number(params.get("example"));
    if (Number.isInteger(ex) && EXAMPLE_OBJECTIVES[ex]) {
      setStatement(EXAMPLE_OBJECTIVES[ex].statement);
      setCriteria(EXAMPLE_OBJECTIVES[ex].criteria);
    } else if (draft.statement) {
      setStatement(draft.statement);
      setCriteria(draft.criteria);
      setNotes(draft.notes);
    }
    setRestored(true);
  }, [draft, params, restored]);

  useEffect(() => {
    if (restored) setDraft({ statement, criteria, notes });
  }, [statement, criteria, notes, restored, setDraft]);

  const max = config.maxDescriptionLength || 4000;
  const valid = statement.trim().length >= 10 && statement.length <= max;
  const budgetCents = budget ?? 2000;
  const contextEmpty = !!ctx && ctx.completeness.filled === 0 && ctx.documents.length === 0;

  const suggest = async () => {
    if (!valid) return;
    setSuggesting(true);
    try {
      const { suggestion } = await api.suggestObjective(statement);
      setCriteria(suggestion.criteria.map((c) => c.description));
      setSuggestedTitle(suggestion.title);
      setQuestions(suggestion.questions);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  };

  const submit = async (asDraft: boolean) => {
    if (!valid) return;
    setBusy(asDraft ? "draft" : "plan");
    try {
      const { objective } = await api.createObjective({
        statement: statement.trim(),
        title: suggestedTitle || undefined,
        successCriteria: criteria.filter((c) => c.trim().length >= 3).map((description) => ({ description: description.trim() })),
        deadline: deadline || null,
        budgetCents,
        contextNotes: notes.trim() || undefined,
        autonomy,
        draft: asDraft,
      });
      setDraft({ statement: "", criteria: [], notes: "" });
      toast(asDraft ? "Saved as a draft" : "Sent to the Chief of Staff");
      router.push(ROUTES.objective(objective.id));
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="narrow" style={{ maxWidth: 860, paddingBottom: 48 }}>
      <div className="pagehead">
        <div className="eyebrow">NEW OBJECTIVE</div>
        <h1>Define an outcome</h1>
        <p>Describe the business result you need. The Chief of Staff plans it, your AI Team does the work, and every result is verified against evidence. Nothing runs or is charged before you approve the plan — unless you allow it within a budget.</p>
      </div>

      {contextEmpty && (
        <div className="banner-info" style={{ marginBottom: 16 }}>
          <Icon name="info" size={15} />
          <span className="small">
            Ensemblis doesn&apos;t know your business yet. <Link href={ROUTES.context} style={{ color: "var(--accent)", fontWeight: 600 }}>Add your Company Context</Link> once (2 minutes) and every objective uses it — or the Chief of Staff will ask.
          </span>
        </div>
      )}

      <div className="card">
        <label className="l" htmlFor="statement">
          What outcome do you need?
        </label>
        <textarea
          id="statement"
          className="f"
          rows={4}
          value={statement}
          maxLength={max}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="e.g. Find the three highest-potential European markets for our product in 2027, with a recommendation for where to focus next quarter."
          data-testid="objective-statement"
          autoFocus
        />
        <div className="row between wrapflex" style={{ marginTop: 6 }}>
          <div className="row wrapflex" style={{ gap: 6 }}>
            <span className="tiny muted">Start from:</span>
            {EXAMPLE_OBJECTIVES.map((e) => (
              <button
                key={e.label}
                type="button"
                className="chip"
                onClick={() => {
                  setStatement(e.statement);
                  setCriteria(e.criteria);
                  setSuggestedTitle("");
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
          <CharCount value={statement} max={max} />
        </div>

        <div className="row between" style={{ marginTop: 22, alignItems: "baseline" }}>
          <label className="l" style={{ margin: 0 }}>
            What does success look like?
          </label>
          <button type="button" className="btn sm" onClick={suggest} disabled={!valid || suggesting} aria-busy={suggesting} data-testid="suggest-criteria">
            <Icon name="spark" />
            Suggest success criteria
          </button>
        </div>
        <p className="hint" style={{ marginTop: 4 }}>
          Measurable statements the result will be checked against. Leave empty and the Chief of Staff proposes them — you can edit them before approving.
        </p>
        <div style={{ marginTop: 10 }}>
          {criteria.map((c, i) => (
            <div className="row" key={i} style={{ marginBottom: 8 }}>
              <span className="tiny muted" style={{ width: 18 }}>
                {i + 1}.
              </span>
              <input
                className="f"
                value={c}
                maxLength={300}
                onChange={(e) => setCriteria((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
                aria-label={`Success criterion ${i + 1}`}
                data-testid="criterion-input"
              />
              <button type="button" className="ibtn" aria-label="Remove criterion" onClick={() => setCriteria((x) => x.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          {criteria.length < 6 && (
            <button type="button" className="btn ghost sm" onClick={() => setCriteria((x) => [...x, ""])}>
              <Icon name="plus" /> Add a criterion
            </button>
          )}
        </div>
        {questions.length > 0 && (
          <div className="banner-info" style={{ marginTop: 12 }}>
            <Icon name="info" size={15} />
            <div className="small">
              <b>The Chief of Staff would also like to know:</b>
              <ul style={{ paddingLeft: 18, margin: "4px 0 0" }}>
                {questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              Add the answers under &ldquo;Relevant context&rdquo; below.
            </div>
          </div>
        )}

        <div className="field-grid" style={{ marginTop: 22 }}>
          <div>
            <label className="l" htmlFor="deadline">
              Deadline <span className="muted">(optional)</span>
            </label>
            <input id="deadline" type="date" className="f" value={deadline} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div>
            <label className="l" htmlFor="budget">
              Budget (execution limit)
            </label>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted">€</span>
              <input
                id="budget"
                type="number"
                className="f"
                min={5}
                max={500}
                step={1}
                value={Math.round(budgetCents / 100)}
                onChange={(e) => setBudget(Math.max(500, Math.min(50000, Math.round(Number(e.target.value || 0) * 100))))}
              />
            </div>
            <p className="hint">Executions estimated above this always need your approval.</p>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <label className="l">Autonomy</label>
          <div className="seg" role="radiogroup" aria-label="Autonomy">
            <button type="button" role="radio" aria-checked={autonomy === "REVIEW_PLAN"} className={autonomy === "REVIEW_PLAN" ? "on" : ""} onClick={() => setAutonomy("REVIEW_PLAN")}>
              Review the plan first
            </button>
            <button type="button" role="radio" aria-checked={autonomy === "AUTO_WITHIN_BUDGET"} className={autonomy === "AUTO_WITHIN_BUDGET" ? "on" : ""} onClick={() => setAutonomy("AUTO_WITHIN_BUDGET")}>
              Run automatically within budget
            </button>
          </div>
          <p className="hint">
            {autonomy === "REVIEW_PLAN"
              ? "You approve the plan and its cost before anything runs."
              : `Starts on its own when the estimate is within ${eur(budgetCents)}${org ? ` and your ${eur(org.approvalThresholdCents)} approval threshold` : ""}; otherwise it asks you.`}
          </p>
        </div>

        <div style={{ marginTop: 18 }}>
          <label className="l" htmlFor="notes">
            Relevant context <span className="muted">(optional)</span>
          </label>
          <textarea id="notes" className="f" rows={3} value={notes} maxLength={8000} onChange={(e) => setNotes(e.target.value)} placeholder="Anything specific to this objective: constraints, what has been tried, who the result is for…" />
          <p className="hint">
            Your <Link href={ROUTES.context} style={{ color: "var(--accent)" }}>Company Context</Link>
            {ctx ? ` (${ctx.completeness.filled}/${ctx.completeness.total} sections, ${ctx.documents.length} document${ctx.documents.length === 1 ? "" : "s"})` : ""} and confirmed memory are used automatically.
          </p>
        </div>

        <div className="row wrapflex" style={{ marginTop: 24, gap: 10 }}>
          <button type="button" className="btn p lg" onClick={() => submit(false)} disabled={!valid || !!busy} aria-busy={busy === "plan"} data-testid="submit-objective">
            Send to the Chief of Staff
            <Icon name="arrow" />
          </button>
          <button type="button" className="btn lg" onClick={() => submit(true)} disabled={!valid || !!busy} aria-busy={busy === "draft"}>
            Save as draft
          </button>
        </div>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          Ensemblis only researches, analyses, drafts and recommends. It never sends email, publishes, changes your systems or spends money on its own.
        </p>
      </div>
    </div>
  );
}
