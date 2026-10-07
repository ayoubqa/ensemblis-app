"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, Modal, useToast, type IconName } from "@/components";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { api, ApiError, type TaskEstimate } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { errorText } from "@/lib/errors";
import { eur, minutesRange } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import S from "./home.module.css";

/** A sentence is enough — but a two-word brief would waste the one free task. */
const MIN_BRIEF = 12;
/** How long unclaimed trial results are kept (server default GUEST_RETENTION_DAYS). */
const KEEP_DAYS = 7;

type Tone = "bad" | "warn" | "info";
interface Problem {
  title: string;
  body: string;
  tone: Tone;
  /** Offer "Create a free account" as the way forward. */
  signup?: boolean;
  /** Offer the full task planner (/new) — only once a guest session exists. */
  planner?: boolean;
}

type CostState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; est: TaskEstimate }
  | { kind: "error" };

/** Live "what will this brief cost at Focused depth?" check, debounced. */
function useFocusedCost(brief: string, enabled: boolean): CostState {
  const text = useDebounced(brief.trim(), 500);
  const [state, setState] = useState<CostState>({ kind: "idle" });
  const cache = useRef(new Map<string, TaskEstimate>());
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled || text.length < MIN_BRIEF) {
      setState({ kind: "idle" });
      return;
    }
    const hit = cache.current.get(text);
    if (hit) {
      setState({ kind: "ok", est: hit });
      return;
    }
    const id = ++seq.current;
    setState({ kind: "loading" });
    api
      .estimateTask({ description: text, depth: "focused" })
      .then(({ estimate }) => {
        cache.current.set(text, estimate);
        if (id === seq.current) setState({ kind: "ok", est: estimate });
      })
      .catch(() => {
        if (id === seq.current) setState({ kind: "error" });
      });
  }, [text, enabled]);

  return state;
}

/** Why `api.guestStart` failed, in plain words. */
function startProblem(e: unknown): Problem {
  const status = e instanceof ApiError ? e.status : -1;
  if (status === 429)
    return {
      tone: "warn",
      title: "The free trial limit has been reached",
      body: errorText(e, "Free trials are limited per network and per day. Create a free account to keep going — it only takes a minute."),
      signup: true,
    };
  if (status === 403)
    return {
      tone: "info",
      title: "The free trial is switched off right now",
      body: errorText(e, "Create a free account instead — it only takes a minute."),
      signup: true,
    };
  if (status === 400)
    return {
      tone: "bad",
      title: "That didn't go through",
      body: errorText(e, "Please complete the security check again and retry."),
    };
  if (status === 0)
    return { tone: "bad", title: "Can't reach Ensemblis", body: "Check your connection and try again in a moment." };
  return { tone: "bad", title: "Couldn't start your free trial", body: errorText(e, "Something went wrong on our side. Please try again.") };
}

/** Why `api.createTask` failed for a (new) guest — the session itself is fine. */
function taskProblem(e: unknown): Problem {
  const status = e instanceof ApiError ? e.status : -1;
  if (status === 402) {
    // Server detail looks like "This brief costs €3.20, more than your €2 trial balance. Try a narrower…"
    const detail = e instanceof ApiError && /costs/i.test(e.message) ? `${e.message.split(". ")[0].replace(/\.$/, "")}. ` : "";
    return {
      tone: "warn",
      title: "This task is too big for the free trial",
      body: `${detail}Try a narrower brief — one question, one market or one competitor works best — or sign up for a free account to add credits.`,
      signup: true,
      planner: true,
    };
  }
  if (status === 403)
    return {
      tone: "info",
      title: "Create a free account to keep going",
      body: errorText(e, "Your trial can't start another task. Everything from your trial is kept when you sign up."),
      signup: true,
    };
  if (status === 429)
    return {
      tone: "warn",
      title: "Today's task limit is reached",
      body: errorText(e, "Please try again later, or create a free account."),
      signup: true,
    };
  if (status === 400) return { tone: "bad", title: "Check your brief", body: errorText(e, "That brief couldn't be planned. Add a little more detail and try again."), planner: true };
  if (status === 0) return { tone: "bad", title: "Can't reach Ensemblis", body: "Check your connection, then try again — your free task hasn't been used.", planner: true };
  return { tone: "bad", title: "The task didn't start", body: errorText(e, "Something went wrong on our side — your free task hasn't been used. Please try again."), planner: true };
}

export interface TrialModalProps {
  open: boolean;
  onClose: () => void;
  /** The hero composer's draft — edited here too, so both stay in sync. */
  brief: string;
  setBrief: (s: string) => void;
}

/**
 * "Try it free — no sign-up": consent (+ Turnstile when configured) →
 * api.guestStart → signIn → api.createTask(focused) → /tasks/<id>.
 * If the guest session starts but the task doesn't, the visitor stays signed
 * in as a guest and the modal explains what to do next.
 */
export function TrialModal({ open, onClose, brief, setBrief }: TrialModalProps) {
  const router = useRouter();
  const toast = useToast();
  const { user, signIn, setUser } = useAuth();
  const { config } = useConfig();
  const guest = !!user?.isGuest;
  const tsRequired = !!config.turnstileSiteKey && !guest;

  const [agreed, setAgreed] = useState(false);
  const [tsToken, setTsToken] = useState<string | null>(null);
  const ts = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState<null | "session" | "task">(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [sessionMade, setSessionMade] = useState(false);
  const going = useRef(false);

  const cost = useFocusedCost(brief, open);
  const budget = guest && user ? user.credits : config.guestCreditsCents;
  const maxLen = config.maxDescriptionLength;

  // Fresh state every time the modal opens (but keep a guest session's context).
  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setSubmitted(false);
    setBusy(null);
    going.current = false;
  }, [open]);

  const trimmed = brief.trim();
  const briefErr = !trimmed
    ? "Describe what you need done — a sentence is enough."
    : trimmed.length < MIN_BRIEF
      ? "Add a little more detail so the agents know what to deliver."
      : trimmed.length > maxLen
        ? `Keep it under ${maxLen.toLocaleString("en-US")} characters.`
        : null;
  const agreeErr = !guest && !agreed ? "Please agree to the Terms and Privacy Policy to start." : null;
  const tsErr = tsRequired && !tsToken ? "Complete the quick security check above." : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || going.current) return;
    setSubmitted(true);
    setProblem(null);
    if (briefErr) return document.getElementById("trial-brief")?.focus();
    if (agreeErr) return document.getElementById("trial-agree")?.focus();
    if (tsErr) return;

    // 1) Guest session (skipped when one already exists, e.g. on a retry).
    if (!guest) {
      setBusy("session");
      try {
        const { token, user: u } = await api.guestStart({ acceptedTerms: true, ...(tsToken ? { turnstileToken: tsToken } : {}) });
        signIn(token, u);
        setSessionMade(true);
      } catch (err) {
        ts.current?.reset(); // tokens are single-use
        setProblem(startProblem(err));
        setBusy(null);
        return;
      }
    }

    // 2) The one focused task.
    setBusy("task");
    try {
      const { task, user: u } = await api.createTask({ description: trimmed, depth: "focused" });
      setUser(u);
      going.current = true;
      toast("Your free task is running — the team is on it", { icon: "spark" });
      router.push(ROUTES.task(task.id));
    } catch (err) {
      setProblem(taskProblem(err));
      setBusy(null);
    }
  };

  const signupHref = `${ROUTES.signup}?${new URLSearchParams(
    guest ? { claim: "1" } : { type: "company", ...(trimmed ? { q: trimmed.slice(0, 2000) } : {}) }
  ).toString()}`;
  const plannerHref = `${ROUTES.newTask}${trimmed ? `?q=${encodeURIComponent(trimmed.slice(0, maxLen))}` : ""}`;

  const facts: [IconName, React.ReactNode][] = [
    ["zap", <><b>1 focused task</b> — a small team of agents, start to finish</>],
    ["eur", <>Up to <b>{eur(config.guestCreditsCents)}</b> of credits, on us</>],
    ["clock", <>Results kept <b>{KEEP_DAYS} days</b> unless you save them with a free account</>],
  ];

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Try it free — no sign-up" dismissible={!busy}>
      <p className="muted small" style={{ margin: 0 }}>
        Run one real task and read the finished report. No account, no card.
      </p>
      <ul className={S.facts} aria-label="What the free trial includes">
        {facts.map(([icon, text]) => (
          <li key={icon} className={S.fact}>
            <span className={S.factIco} aria-hidden="true">
              <Icon name={icon} size={15} />
            </span>
            <span style={{ paddingTop: 4 }}>{text}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} noValidate>
        <div className={S.brief}>
          <label className="l" htmlFor="trial-brief">
            Your brief
          </label>
          <textarea
            id="trial-brief"
            className="f"
            rows={3}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            maxLength={maxLen}
            placeholder="e.g. Summarise the three biggest trends in European e-bike sales this year, with sources."
            aria-invalid={submitted && !!briefErr}
            aria-describedby="trial-brief-note"
            data-autofocus={trimmed.length < MIN_BRIEF ? "" : undefined}
            disabled={!!busy}
          />
          <div id="trial-brief-note" aria-live="polite">
            {submitted && briefErr ? (
              <div className="err">{briefErr}</div>
            ) : (
              <CostLine state={cost} budget={budget} short={trimmed.length < MIN_BRIEF} />
            )}
          </div>
        </div>

        {!guest && (
          <>
            <label className={S.agree} htmlFor="trial-agree">
              <input
                id="trial-agree"
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                required
                aria-invalid={submitted && !!agreeErr}
                aria-describedby={submitted && agreeErr ? "trial-agree-err" : undefined}
                disabled={!!busy}
                data-autofocus={trimmed.length >= MIN_BRIEF ? "" : undefined}
              />
              <span>
                I agree to the{" "}
                <a href={ROUTES.terms} target="_blank" rel="noopener noreferrer">
                  Terms<span className="sr-only"> (opens in a new tab)</span>
                </a>{" "}
                and{" "}
                <a href={ROUTES.privacy} target="_blank" rel="noopener noreferrer">
                  Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </span>
            </label>
            {submitted && agreeErr && (
              <div className="err" id="trial-agree-err" style={{ paddingLeft: 28 }}>
                {agreeErr}
              </div>
            )}
            <Turnstile ref={ts} onToken={setTsToken} action="guest-start" />
            {submitted && tsErr && (
              <div className="err" role="alert">
                {tsErr}
              </div>
            )}
          </>
        )}

        {guest && (sessionMade || problem) && (
          <div className={S.session}>
            <Icon name="check" size={15} />
            <span>
              <b>You&apos;re signed in as a guest.</b>{" "}
              {problem?.planner
                ? "Your free task hasn't been used yet — adjust the brief and try again, or open the full planner."
                : "Your trial session is saved in this browser."}
            </span>
          </div>
        )}

        {problem && (
          <div
            className={`${S.problem} ${problem.tone === "bad" ? S.problemBad : problem.tone === "warn" ? S.problemWarn : S.problemInfo}`}
            role="alert"
          >
            <Icon name={problem.tone === "info" ? "info" : "alert"} size={16} />
            <div style={{ minWidth: 0 }}>
              <b>{problem.title}</b>
              <p>{problem.body}</p>
              {(problem.signup || (problem.planner && guest)) && (
                <div className={S.problemActions}>
                  {problem.signup && (
                    <Link className="btn p sm" href={signupHref}>
                      {guest ? "Save trial & create account" : "Create a free account"}
                      <Icon name="arrow" size={14} />
                    </Link>
                  )}
                  {problem.planner && guest && (
                    <Link className="btn sm" href={plannerHref}>
                      Open the planner
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <button type="submit" className="btn p lg block" style={{ marginTop: 18 }} disabled={!!busy} aria-busy={!!busy}>
          {busy === "session"
            ? "Starting your free session…"
            : busy === "task"
              ? "Briefing your agent team…"
              : problem && guest
                ? "Try again"
                : "Start my free task"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>

      <p className={`tiny muted ${S.fine}`}>
        {guest ? (
          <>
            Want to keep everything?{" "}
            <Link href={signupHref} style={{ color: "var(--accent)", fontWeight: 600 }}>
              Create a free account
            </Link>
          </>
        ) : (
          <>
            Prefer an account?{" "}
            <Link href={signupHref} style={{ color: "var(--accent)", fontWeight: 600 }}>
              Sign up free
            </Link>{" "}
            · AI output can be wrong — verify before relying on it.
          </>
        )}
      </p>
    </Modal>
  );
}

function CostLine({ state, budget, short }: { state: CostState; budget: number; short: boolean }) {
  if (short)
    return (
      <div className={S.costLine}>
        <Icon name="info" size={14} />
        <span>A sentence is enough. Free trial tasks run at Focused depth.</span>
      </div>
    );
  if (state.kind === "loading" || state.kind === "idle")
    return (
      <div className={S.costLine}>
        <span className={`spin ${S.spinWrap}`} style={{ width: 13, height: 13 }} aria-hidden="true" />
        <span>Checking what this brief needs…</span>
      </div>
    );
  if (state.kind === "error")
    return (
      <div className={S.costLine}>
        <Icon name="info" size={14} />
        <span>Couldn&apos;t preview the cost — you can still start.</span>
      </div>
    );
  const { est } = state;
  const fits = budget <= 0 || est.costCents <= budget;
  return fits ? (
    <div className={`${S.costLine} ${S.costOk}`}>
      <Icon name="check" size={14} />
      <span>
        About <b>{eur(est.costCents)}</b> · {minutesRange(est.estMinutesLow, est.estMinutesHigh)} — covered by your free trial
      </span>
    </div>
  ) : (
    <div className={`${S.costLine} ${S.costWarn}`}>
      <Icon name="alert" size={14} />
      <span>
        About <b>{eur(est.costCents)}</b> — more than the {eur(budget)} the trial covers. Try a narrower brief.
      </span>
    </div>
  );
}
