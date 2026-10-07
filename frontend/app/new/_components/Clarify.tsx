"use client";

import { useEffect, useRef, useState } from "react";
import type { ClarifyQuestion } from "@/lib/api";
import { Icon } from "@/components";
import { useKeyboardShortcut } from "@/lib/hooks";

export interface ClarifyAnswer {
  question: string;
  answer: string;
}

const MAX_ANSWER = 300;
const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 4;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Defensive clean-up of what the server sent: 0–3 questions, 0–4 short unique options each. */
export function cleanQuestions(raw: unknown): ClarifyQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ClarifyQuestion[] = [];
  for (const [i, q] of raw.entries()) {
    if (!q || typeof q !== "object") continue;
    const r = q as Partial<ClarifyQuestion>;
    const question = typeof r.question === "string" ? oneLine(r.question).slice(0, 240) : "";
    if (!question) continue;
    const options = Array.isArray(r.options)
      ? Array.from(new Set(r.options.filter((o): o is string => typeof o === "string").map((o) => oneLine(o).slice(0, 80)).filter(Boolean))).slice(0, MAX_OPTIONS)
      : [];
    out.push({ id: typeof r.id === "string" && r.id ? r.id : `q${i}`, question, options });
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

/** The block appended to the brief when answers are applied. */
export function clarificationBlock(answers: ClarifyAnswer[]): string {
  return "\n\nClarifications:\n" + answers.map((a) => `- Q: ${oneLine(a.question)} A: ${oneLine(a.answer)}`).join("\n");
}

/** True when the brief already carries applied answers (don't ask again). */
export const hasClarifications = (description: string) => description.includes("\n\nClarifications:\n");

/**
 * "A few quick questions to sharpen the brief" — optional. Each question has
 * quick-pick chips (toggle) plus a free-text field; both combine into one answer.
 */
export function ClarifyCard({
  questions,
  onSkip,
  onApply,
  autoFocus,
}: {
  questions: ClarifyQuestion[];
  onSkip: () => void;
  /** Returns an error message to show, or null when applied. */
  onApply: (answers: ClarifyAnswer[]) => string | null;
  autoFocus: boolean;
}) {
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const [text, setText] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (autoFocus) headRef.current?.focus({ preventScroll: false });
  }, [autoFocus]);

  const answers: ClarifyAnswer[] = questions
    .map((q) => {
      const parts = [picked[q.id] ?? "", oneLine(text[q.id] ?? "")].filter(Boolean);
      return { question: q.question, answer: parts.join(" — ") };
    })
    .filter((a) => a.answer);
  const n = answers.length;

  const apply = () => {
    if (!n) return;
    const err = onApply(answers);
    setError(err);
  };
  useKeyboardShortcut("mod+enter", () => (n ? apply() : onSkip()), { allowInInputs: true });

  return (
    <section className="card reveal" aria-labelledby="clarify-title" style={{ marginTop: 14, borderColor: "var(--accent)" }}>
      <div className="row between wrapflex" style={{ gap: 8 }}>
        <span className="tag">
          <Icon name="check" />
          Your plan is ready
        </span>
        <span className="tag gray">Optional</span>
      </div>
      <h2
        id="clarify-title"
        ref={headRef}
        tabIndex={-1}
        style={{ fontFamily: "var(--serif)", fontSize: 21, fontWeight: 500, lineHeight: 1.2, margin: "14px 0 4px", outline: "none" }}
      >
        A few quick questions to sharpen the brief
      </h2>
      <p className="small muted" style={{ maxWidth: "62ch" }}>
        Answer any that matter — your answers are added to the brief and the plan is updated. Or skip straight to the plan.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <ol style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 18 }}>
          {questions.map((q, i) => {
            const qid = `cq-${i}`;
            const sel = picked[q.id] ?? null;
            return (
              <li key={q.id}>
                <div id={qid} className="small" style={{ fontWeight: 600, display: "flex", gap: 8 }}>
                  <span className="muted" aria-hidden="true" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {i + 1}.
                  </span>
                  <span>{q.question}</span>
                </div>
                {q.options.length > 0 && (
                  <div className="row wrapflex" style={{ gap: 6, marginTop: 9 }} role="group" aria-labelledby={qid}>
                    {q.options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        className={sel === o ? "chip on" : "chip"}
                        aria-pressed={sel === o}
                        onClick={() => {
                          setPicked((p) => ({ ...p, [q.id]: sel === o ? null : o }));
                          setError(null);
                        }}
                      >
                        {sel === o && <Icon name="check" />}
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  className="f"
                  style={{ marginTop: 9, fontSize: 14, padding: "9px 12px" }}
                  value={text[q.id] ?? ""}
                  maxLength={MAX_ANSWER}
                  aria-labelledby={qid}
                  aria-describedby={error ? "clarify-err" : undefined}
                  placeholder={sel ? "Add detail (optional)" : q.options.length ? "Or type your own answer" : "Type your answer"}
                  onChange={(e) => {
                    setText((t) => ({ ...t, [q.id]: e.target.value }));
                    setError(null);
                  }}
                />
              </li>
            );
          })}
        </ol>
        {error && (
          <p id="clarify-err" className="err" role="alert" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
        <div className="row between wrapflex" style={{ marginTop: 18, gap: 10 }}>
          <button type="button" className="btn" onClick={onSkip}>
            Skip<span className="sr-only"> the questions and review the plan</span>
          </button>
          <button type="submit" className="btn p lg" disabled={!n} aria-describedby="clarify-count">
            Apply answers <Icon name="arrow" />
          </button>
        </div>
        <div id="clarify-count" className="tiny muted" style={{ marginTop: 8, textAlign: "right" }} aria-live="polite">
          {n ? `${n} of ${questions.length} answered · added to your brief as “Clarifications”` : "Pick an option or type an answer to apply it"}
        </div>
      </form>
    </section>
  );
}
