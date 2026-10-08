"use client";

import Link from "next/link";
import { forwardRef, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type RefObject } from "react";
import { Icon, Lockup, type IconName } from "@/components";
import { ApiError } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { SITE } from "@/lib/site";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ------------------------------------------------------------------ shell

/** What actually happens after sign-up, in product order (no claims beyond what the product does). */
const STEPS: { title: string; body: string }[] = [
  { title: "Tell us about your company", body: "Company Context grounds every plan in what you do, who you serve and where you're headed." },
  { title: "Define an outcome", body: "Describe the objective and the success criteria it has to meet." },
  { title: "Approve the plan", body: "Your Chief of Staff proposes the steps, the AI Team and an estimated cost for you to review." },
  { title: "Get a verified outcome", body: "The AI Team executes, and the result is checked against evidence and your success criteria." },
];

// "Describe the outcome." / "We do the work." (the second sentence carries the accent).
const PROMISE_CUT = SITE.promise.indexOf(". ") + 1;
const PROMISE_A = SITE.promise.slice(0, PROMISE_CUT);
const PROMISE_B = SITE.promise.slice(PROMISE_CUT + 1);

/**
 * The frame every auth and onboarding page renders in (/login, /signup, /forgot-password,
 * /reset-password, /verify-email, /join). Desktop: a navy brand panel (official lockup,
 * positioning, the four steps) beside a focused form panel. Below 960px the form is a single
 * clean column; with `stepsOnMobile` the four steps follow it as a compact list (sign-up).
 */
export function AuthShell({ children, intro = "how", stepsOnMobile }: { children: ReactNode; intro?: "next" | "how"; stepsOnMobile?: boolean }) {
  return (
    <div className={stepsOnMobile ? "au au-mobsteps" : "au"}>
      <div className="au-frame">
        <aside className="au-brand dk" aria-label="How Ensemblis works">
          <Link href="/" className="au-brand-home" aria-label="Ensemblis home">
            <Lockup size={28} />
          </Link>
          <div className="au-brand-copy">
            <p className="eyebrow">{SITE.positioning.replace(/\.$/, "")}</p>
            <p className="au-promise">
              {PROMISE_A} <span>{PROMISE_B}</span>
            </p>
          </div>
          <div className="au-brand-steps">
            <p className="au-k">{intro === "next" ? "What happens next" : "How it works"}</p>
            <ol className="au-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="au-step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>
                    <span className="au-step-t">{s.title}</span>
                    <span className="au-step-d">{s.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <p className="au-brand-note">
            <Icon name="shield" size={16} />
            <span>By default, nothing is executed or charged until you approve the plan.</span>
          </p>
        </aside>
        <div className="au-main">
          <div className="au-panel">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ headings & states

type Tone = "accent" | "ok" | "warn" | "bad";

/** Icon badge (optional) + the page's single h1 + a lead paragraph. */
export function AuthHead({
  icon,
  tone = "accent",
  tag,
  title,
  children,
  titleRef,
  describedBy,
}: {
  icon?: IconName;
  tone?: Tone;
  tag?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  titleRef?: RefObject<HTMLHeadingElement>;
  describedBy?: string;
}) {
  return (
    <header className="au-head">
      {icon && (
        <span className={`au-badge ${tone}`} aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
      )}
      {tag}
      <h1 className="au-title" ref={titleRef} tabIndex={titleRef ? -1 : undefined} aria-describedby={describedBy}>
        {title}
      </h1>
      {children && <p className="au-lead">{children}</p>}
    </header>
  );
}

/**
 * Icon badge + heading + copy for the auth flows' non-form states (link sent, link expired,
 * email off…). The heading takes focus when the state appears, so keyboard and screen-reader
 * users aren't stranded when a form is swapped out; its body is read as the description.
 */
export function AuthStatus({
  icon,
  tone = "accent",
  title,
  children,
  actions,
  busy,
}: {
  icon: IconName;
  tone?: Tone;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
}) {
  const h = useRef<HTMLHeadingElement>(null);
  const bodyId = useId();
  useEffect(() => {
    h.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <div className="au-status reveal" aria-busy={busy || undefined}>
      <header className="au-head">
        <span className={`au-badge ${tone}`} aria-hidden="true">
          {busy ? <span className="spin" /> : <Icon name={icon} size={20} />}
        </span>
        <h1 className="au-title" ref={h} tabIndex={-1} aria-describedby={children ? bodyId : undefined}>
          {title}
        </h1>
      </header>
      {children && (
        <div className="au-status-body" id={bodyId}>
          {children}
        </div>
      )}
      {actions && <div className="au-actions">{actions}</div>}
    </div>
  );
}

/** Accessible loading placeholder: one polite status message; the skeleton bars are hidden from assistive tech. */
export function AuthLoading({ label = "Loading…", lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div className="au-loading" role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <div className="sk au-sk-title" />
        <div className="sk au-sk-lead" />
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="sk au-sk-field" />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ form parts

/**
 * Label + control + one line of help. The error (`${id}-err`) replaces the hint (`${id}-hint`)
 * while it shows; pages point the control's aria-describedby at whichever is rendered.
 * `aside` sits on the label row (e.g. "Forgot password?").
 */
export function Field({
  id,
  label,
  error,
  hint,
  optional,
  aside,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: ReactNode | null;
  hint?: ReactNode;
  optional?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="au-field">
      <div className="au-labelrow">
        <label className="l" htmlFor={id}>
          {label}
          {optional && <span className="au-opt"> (optional)</span>}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p className="au-err" id={`${id}-err`}>
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="au-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {off ? (
        <>
          <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17.6 17.6 0 0 1-3.2 3.9" />
          <path d="M6.6 7.6C3.9 9.4 2 12 2 12s3.6 6 10 6a9.6 9.6 0 0 0 4.3-1" />
          <path d="M9.9 10a3 3 0 0 0 4.1 4.1M3 3l18 18" />
        </>
      ) : (
        <>
          <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

/**
 * Password field with a show/hide toggle. The toggle's name says what it will do; no aria-pressed
 * (one or the other, never both). Forwards its ref to the input.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="au-pw">
      <input {...props} ref={ref} type={show ? "text" : "password"} className="f" />
      <button type="button" className="au-pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-controls={props.id}>
        <EyeIcon off={show} />
      </button>
    </div>
  );
});

/** 0–4 strength score with a 4-segment meter. */
export function strength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  else if (/\d|[^A-Za-z0-9]/.test(pw)) s += 0.5;
  return Math.min(4, Math.floor(s));
}

/**
 * Visual strength meter. Not a live region (it would speak on every keystroke): pass `id` and
 * add it to the input's aria-describedby so the current reading is announced on focus.
 */
export function StrengthMeter({ pw, id }: { pw: string; id?: string }) {
  if (!pw) return null;
  const s = pw.length < 8 ? 0 : Math.max(1, strength(pw));
  const label = pw.length < 8 ? `${8 - pw.length} more ${8 - pw.length === 1 ? "character" : "characters"}` : ["", "Okay", "Good", "Strong", "Very strong"][s];
  const level = s <= 1 ? "weak" : s === 2 ? "fair" : "strong";
  return (
    <div className="au-meter" data-level={level}>
      <div className="au-meter-bar" aria-hidden="true">
        {[1, 2, 3, 4].map((k) => (
          <i key={k} className={k <= s ? "on" : undefined} />
        ))}
      </div>
      <span id={id}>
        <span className="sr-only">Password strength: </span>
        {label}
      </span>
    </div>
  );
}

/** A tinted inline message. `role="alert"` only for errors that need announcing. */
export function AuthNotice({
  tone = "accent",
  icon = "info",
  title,
  children,
  alert,
}: {
  tone?: Tone | "neutral";
  icon?: IconName;
  title?: ReactNode;
  children: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className={`au-notice ${tone}`} role={alert ? "alert" : undefined}>
      <Icon name={icon} size={16} />
      <div>
        {title && <b>{title}</b>}
        {children}
      </div>
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <AuthNotice tone="bad" icon="alert" alert>
      {children}
    </AuthNotice>
  );
}

/**
 * Focus a field on mount — but only with a fine pointer. On touch devices autofocus opens the
 * soft keyboard and pushes the heading out of view.
 */
export function useAutoFocus(ref: RefObject<HTMLElement>, when = true) {
  useEffect(() => {
    if (!when) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) ref.current?.focus();
  }, [when, ref]);
}

/** errorText(), with the server's bot-check wording mapped onto the UI's "security check". */
export function authErrorText(e: unknown, fallback?: string): string {
  if (e instanceof ApiError && /bot check/i.test(e.message)) return "The security check didn't complete. Please try it again.";
  return errorText(e, fallback);
}
