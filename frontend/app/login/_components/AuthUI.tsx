"use client";

import Link from "next/link";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon, Lockup } from "@/components";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Centered modal-style card used by /login and /signup. */
export function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="hero-dk" style={{ padding: "48px 0 72px", minHeight: "calc(100vh - 140px)" }}>
      <div className="wrap hx" style={{ display: "grid", placeItems: "start center" }}>
        <div className="card reveal" style={{ width: "100%", maxWidth: wide ? 640 : 460, padding: "30px 30px 26px", boxShadow: "var(--shadow)" }}>
          <Link href="/" aria-label="Ensemblis home" style={{ display: "inline-flex", color: "var(--ink)", marginBottom: 22 }}>
            <Lockup size={26} />
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  optional,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: ReactNode | null;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <label className="l" htmlFor={id}>
        {label} {optional && <span className="tiny muted">(optional)</span>}
      </label>
      {children}
      {error ? (
        <div className="err" id={`${id}-err`} role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input {...props} type={show ? "text" : "password"} className="f" style={{ paddingRight: 64, ...props.style }} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="tiny"
        style={{
          position: "absolute",
          right: 6,
          top: "50%",
          transform: "translateY(-50%)",
          background: "none",
          border: 0,
          padding: "6px 8px",
          color: "var(--muted)",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

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

export function StrengthMeter({ pw }: { pw: string }) {
  if (!pw) return null;
  const s = pw.length < 8 ? 0 : Math.max(1, strength(pw));
  const label = pw.length < 8 ? `${8 - pw.length} more ${8 - pw.length === 1 ? "character" : "characters"}` : ["", "Okay", "Good", "Strong", "Very strong"][s];
  const color = s <= 1 ? "var(--warn)" : s === 2 ? "var(--accent)" : "var(--ok)";
  return (
    <div className="row" style={{ gap: 8, marginTop: 7 }} aria-live="polite">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, flex: 1 }} aria-hidden="true">
        {[1, 2, 3, 4].map((k) => (
          <i key={k} style={{ display: "block", height: 4, borderRadius: 2, background: k <= s ? color : "var(--line2)", transition: "background .2s" }} />
        ))}
      </div>
      <span className="tiny muted" style={{ minWidth: 92, textAlign: "right" }}>
        {label}
      </span>
    </div>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="row" style={{ margin: "18px 0", gap: 10 }}>
      <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
      <span className="tiny muted">{children}</span>
      <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="alert" style={{ marginTop: 16, background: "var(--bad-soft)", color: "var(--bad)" }}>
      <Icon name="alert" />
      <span>{children}</span>
    </div>
  );
}
