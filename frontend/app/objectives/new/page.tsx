"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, type Autonomy, type ContextPayload, type Organization } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { EXAMPLE_OBJECTIVES } from "@/lib/data";
import { eur } from "@/lib/format";
import { useLocalStorage } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { CharCount, Icon, RequireAuth, useToast, type IconName } from "@/components";

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
const MIN_BUDGET = 5;
const MAX_BUDGET = 500;

/** Today's date in the visitor's time zone, as yyyy-mm-dd (the date input's `min`). */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  // What the budget field shows while it is being edited (clamped to €5–€500 on blur).
  const [budgetText, setBudgetText] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState<Autonomy>("REVIEW_PLAN");
  const autonomyTouched = useRef(false);
  const [org, setOrg] = useState<Organization | null>(null);
  const [ctx, setCtx] = useState<ContextPayload | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<{ title: string; for: string } | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [busy, setBusy] = useState<"plan" | "draft" | null>(null);
  const [restored, setRestored] = useState(false);
  const statementRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.getOrg().then(({ organization }) => {
      setOrg(organization);
      if (!autonomyTouched.current) setAutonomy(organization.defaultAutonomy);
      setBudget((b) => b ?? Math.max(500, organization.approvalThresholdCents));
    }).catch(() => undefined);
    api.getContext().then(setCtx).catch(() => undefined);
  }, []);

  // Focus the statement on larger screens only (on phones it would open the keyboard over the page).
  useEffect(() => {
    if (window.matchMedia("(min-width: 860px)").matches) statementRef.current?.focus({ preventScroll: true });
  }, []);

  // Restore an unsent draft once (or apply ?example=n).
  useEffect(() => {
    if (restored) return;
    // Only an explicit ?example=n applies an example (Number(null) would be 0).
    const raw = params.get("example");
    const ex = raw !== null && /^\d+$/.test(raw) ? Number(raw) : -1;
    if (ex >= 0 && EXAMPLE_OBJECTIVES[ex]) {
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
  // A suggested title only applies to the statement it was suggested for.
  const title = suggested && suggested.for === statement.trim() ? suggested.title : undefined;

  const chooseAutonomy = (a: Autonomy) => {
    autonomyTouched.current = true;
    setAutonomy(a);
  };

  const commitBudget = (text: string) => {
    const n = Math.round(Number(text));
    const euros = Number.isFinite(n) && n > 0 ? Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, n)) : MIN_BUDGET;
    setBudget(euros * 100);
    setBudgetText(null);
  };

  const suggest = async () => {
    if (!valid) return;
    setSuggesting(true);
    try {
      const { suggestion } = await api.suggestObjective(statement);
      setCriteria(suggestion.criteria.map((c) => c.description));
      setSuggested({ title: suggestion.title, for: statement.trim() });
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
        title,
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

  const auto = autonomy === "AUTO_WITHIN_BUDGET";
  const autoHint = `Starts on its own when the estimate is within ${eur(budgetCents)}${org ? ` and your ${eur(org.approvalThresholdCents)} approval threshold` : ""}; otherwise it asks you.`;

  const NEXT: { icon: IconName; title: string; body: string }[] = [
    { icon: "compass", title: "Plan", body: "The Chief of Staff frames your objective with your Company Context and writes a short plan — each step owned by an executive, with an estimated cost." },
    {
      icon: "check",
      title: "Your approval",
      body: auto
        ? `You chose to start automatically: it begins once the estimate is within ${eur(budgetCents)}${org ? ` and your ${eur(org.approvalThresholdCents)} threshold` : ""}. Anything above waits for you.`
        : "You review the plan and its cost. Nothing is executed or charged before you approve.",
    },
    { icon: "layers", title: "Execution", body: "Specialists in your AI Team research and analyse with read-only tools. You can follow every step as it happens." },
    { icon: "shield", title: "Verification", body: "Claims are checked against the evidence and each success criterion is assessed before the outcome is delivered." },
  ];

  return (
    <div className="wrap ws-page ws-define">
      <header className="ws-hero">
        <div className="eyebrow">
          <Icon name="target" size={14} />
          Define an outcome
        </div>
        <h1>What do you want to achieve?</h1>
        <p>Tell Ensemblis the business result you need. The Chief of Staff plans it, your AI Team does the work, and the result is verified against evidence before it reaches you.</p>
      </header>

      <div className="ws-define-grid">
        <div className="ws-define-main">
          {contextEmpty && (
            <div className="ws-callout" role="note">
              <Icon name="info" size={16} />
              <p>
                Ensemblis doesn&apos;t know your business yet. <Link href={ROUTES.context}>Add your Company Context</Link> once and every objective uses it — or the Chief of Staff will ask what it needs.
              </p>
            </div>
          )}

          <div className="ws-panel ws-form">
            {/* 01 — the outcome */}
            <section className="ws-fs" aria-labelledby="ws-fs-1">
              <h2 className="ws-fs-title" id="ws-fs-1">
                <span className="ws-fs-n" aria-hidden="true">
                  01
                </span>
                <label htmlFor="statement">The outcome you need</label>
              </h2>
              <p className="ws-fs-hint" id="statement-hint">
                In plain language: the result, and what it is for.
              </p>
              <textarea
                id="statement"
                ref={statementRef}
                className="f ws-statement"
                rows={4}
                value={statement}
                maxLength={max}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="e.g. Find the three highest-potential European markets for our product in 2027, with a recommendation for where to focus next quarter."
                aria-describedby="statement-hint statement-count"
                data-testid="objective-statement"
              />
              <div className="ws-statement-foot">
                <div className="ws-examples" role="group" aria-label="Start from an example">
                  <span className="ws-examples-l">Start from an example</span>
                  {EXAMPLE_OBJECTIVES.map((e) => (
                    <button
                      key={e.label}
                      type="button"
                      className="chip"
                      onClick={() => {
                        setStatement(e.statement);
                        setCriteria(e.criteria);
                        setSuggested(null);
                        setQuestions([]);
                      }}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
                <CharCount value={statement} max={max} id="statement-count" />
              </div>
            </section>

            {/* 02 — success criteria */}
            <section className="ws-fs" aria-labelledby="ws-fs-2">
              <div className="ws-fs-row">
                <h2 className="ws-fs-title" id="ws-fs-2">
                  <span className="ws-fs-n" aria-hidden="true">
                    02
                  </span>
                  Success criteria
                </h2>
                <button
                  type="button"
                  className="btn sm"
                  onClick={suggest}
                  disabled={!valid || suggesting}
                  aria-busy={suggesting}
                  aria-describedby={valid ? undefined : "suggest-why"}
                  data-testid="suggest-criteria"
                >
                  <Icon name="list" />
                  {suggesting ? "Suggesting…" : "Suggest success criteria"}
                </button>
              </div>
              <p className="ws-fs-hint">
                Measurable statements the result will be checked against. Leave empty and the Chief of Staff proposes them — you can edit them before approving.
                {!valid && (
                  <span id="suggest-why" className="ws-why">
                    {" "}
                    Describe the outcome first (at least 10 characters) to get suggestions.
                  </span>
                )}
              </p>
              {criteria.length > 0 && (
                <ol className="ws-crit">
                  {criteria.map((c, i) => (
                    <li key={i}>
                      <span className="ws-crit-n" aria-hidden="true">
                        {i + 1}
                      </span>
                      <input
                        className="f"
                        value={c}
                        maxLength={300}
                        onChange={(e) => setCriteria((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
                        aria-label={`Success criterion ${i + 1}`}
                        placeholder="e.g. 3 markets, ranked with a rationale"
                        data-testid="criterion-input"
                      />
                      <button type="button" className="ibtn" aria-label={`Remove success criterion ${i + 1}`} onClick={() => setCriteria((x) => x.filter((_, j) => j !== i))}>
                        <Icon name="x" />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {criteria.length < 6 ? (
                <button type="button" className="btn ghost sm ws-add" onClick={() => setCriteria((x) => [...x, ""])}>
                  <Icon name="plus" /> Add a criterion
                </button>
              ) : (
                <p className="ws-fs-hint">Up to 6 success criteria.</p>
              )}
              <div aria-live="polite">
                {questions.length > 0 && (
                  <div className="ws-callout ws-questions">
                    <Icon name="compass" size={16} />
                    <div>
                      <b>The Chief of Staff would also like to know:</b>
                      <ul>
                        {questions.map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                      <span>Add the answers under &ldquo;Context for this objective&rdquo; below.</span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* 03 — deadline & budget */}
            <section className="ws-fs" aria-labelledby="ws-fs-3">
              <h2 className="ws-fs-title" id="ws-fs-3">
                <span className="ws-fs-n" aria-hidden="true">
                  03
                </span>
                Deadline &amp; budget
              </h2>
              <div className="ws-fields">
                <div>
                  <label className="l" htmlFor="deadline">
                    Deadline <span className="ws-opt-l">(optional)</span>
                  </label>
                  <input id="deadline" type="date" className="f" value={deadline} min={localToday()} onChange={(e) => setDeadline(e.target.value)} />
                </div>
                <div>
                  <label className="l" htmlFor="budget">
                    Budget limit
                  </label>
                  <div className="ws-money">
                    <span aria-hidden="true">€</span>
                    <input
                      id="budget"
                      type="number"
                      inputMode="numeric"
                      className="f"
                      min={MIN_BUDGET}
                      max={MAX_BUDGET}
                      step={1}
                      value={budgetText ?? String(Math.round(budgetCents / 100))}
                      onChange={(e) => {
                        setBudgetText(e.target.value);
                        const n = Math.round(Number(e.target.value));
                        if (e.target.value !== "" && n >= MIN_BUDGET && n <= MAX_BUDGET) setBudget(n * 100);
                      }}
                      onBlur={(e) => commitBudget(e.target.value)}
                      aria-describedby="budget-hint"
                    />
                  </div>
                  <p className="hint" id="budget-hint">
                    In euros, €{MIN_BUDGET}–€{MAX_BUDGET}. Executions estimated above this always need your approval.
                  </p>
                </div>
              </div>
            </section>

            {/* 04 — context */}
            <section className="ws-fs" aria-labelledby="ws-fs-4">
              <h2 className="ws-fs-title" id="ws-fs-4">
                <span className="ws-fs-n" aria-hidden="true">
                  04
                </span>
                <label htmlFor="notes">
                  Context for this objective <span className="ws-opt-l">(optional)</span>
                </label>
              </h2>
              <textarea id="notes" className="f" rows={3} value={notes} maxLength={8000} onChange={(e) => setNotes(e.target.value)} placeholder="Constraints, what has been tried, who the result is for…" aria-describedby="notes-hint" />
              <p className="hint" id="notes-hint">
                Your <Link href={ROUTES.context}>Company Context</Link>
                {ctx ? ` (${ctx.completeness.filled}/${ctx.completeness.total} sections, ${ctx.documents.length} document${ctx.documents.length === 1 ? "" : "s"})` : ""} and confirmed memory are used automatically.
              </p>
            </section>

            {/* 05 — autonomy */}
            <section className="ws-fs" aria-labelledby="ws-fs-5">
              <h2 className="ws-fs-title" id="ws-fs-5">
                <span className="ws-fs-n" aria-hidden="true">
                  05
                </span>
                Autonomy
              </h2>
              <div className="ws-choice" role="radiogroup" aria-labelledby="ws-fs-5">
                <label className={!auto ? "ws-choice-o on" : "ws-choice-o"}>
                  <input type="radio" name="autonomy" value="REVIEW_PLAN" checked={!auto} onChange={() => chooseAutonomy("REVIEW_PLAN")} />
                  <span>
                    <b>Review the plan first</b>
                    <span>You approve the plan and its cost before any work starts.</span>
                  </span>
                </label>
                <label className={auto ? "ws-choice-o on" : "ws-choice-o"}>
                  <input type="radio" name="autonomy" value="AUTO_WITHIN_BUDGET" checked={auto} onChange={() => chooseAutonomy("AUTO_WITHIN_BUDGET")} />
                  <span>
                    <b>Start automatically within budget</b>
                    <span>{autoHint}</span>
                  </span>
                </label>
              </div>
            </section>

            <div className="ws-form-foot">
              <div className="ws-form-actions">
                <button
                  type="button"
                  className="btn p lg"
                  onClick={() => submit(false)}
                  disabled={!valid || !!busy}
                  aria-busy={busy === "plan"}
                  aria-describedby={valid ? undefined : "submit-why"}
                  data-testid="submit-objective"
                >
                  Send to the Chief of Staff
                  <Icon name="arrow" />
                </button>
                <button type="button" className="btn lg" onClick={() => submit(true)} disabled={!valid || !!busy} aria-busy={busy === "draft"}>
                  Save as draft
                </button>
              </div>
              {!valid && (
                <p className="ws-why" id="submit-why">
                  {statement.length > max ? `Shorten the outcome to ${max.toLocaleString("en-US")} characters.` : "Describe the outcome (at least 10 characters) to send it."}
                </p>
              )}
            </div>
          </div>
        </div>

        <aside className="ws-define-side" aria-labelledby="ws-next-h">
          <div className="ws-panel ws-next">
            <h2 id="ws-next-h">What happens next</h2>
            <ol>
              {NEXT.map((s) => (
                <li key={s.title}>
                  <span className="ws-next-ico" aria-hidden="true">
                    <Icon name={s.icon} size={15} />
                  </span>
                  <span>
                    <b>{s.title}</b>
                    <span>{s.body}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="ws-next-out">
              <Icon name="flag" size={15} />
              <span>
                You receive the <b>outcome</b> with its evidence and each success criterion measured. What was learned is proposed for Memory.
              </span>
            </p>
          </div>
          <div className="ws-panel ws-next-safe">
            <Icon name="lock" size={16} />
            <p>Ensemblis only researches, analyses, drafts and recommends. It never sends email on your behalf, publishes, changes your systems or spends money on its own.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
