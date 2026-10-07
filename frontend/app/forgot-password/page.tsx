"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CONTACT_EMAIL, useConfig } from "@/lib/config";
import { errorText } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { AuthShell, AuthStatus, EMAIL_RE, Field, FormError } from "../login/_components/AuthUI";

const RESEND_SECONDS = 30;

export default function ForgotPasswordPage() {
  const { config, loaded } = useConfig();
  // If /api/config never answers, stop waiting and show the form — the request itself will explain.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setGaveUp(true), 4000);
    return () => clearTimeout(t);
  }, [loaded]);

  if (!loaded && !gaveUp) {
    return (
      <AuthShell>
        <div aria-busy="true" aria-label="Loading">
          <div className="sk" style={{ height: 30, width: "64%" }} />
          <div className="sk" style={{ height: 14, width: "92%", marginTop: 12 }} />
          <div className="sk" style={{ height: 44, marginTop: 24 }} />
          <div className="sk" style={{ height: 48, marginTop: 20 }} />
        </div>
      </AuthShell>
    );
  }

  return <AuthShell>{loaded && !config.emailEnabled ? <EmailOff /> : <ForgotForm />}</AuthShell>;
}

// ------------------------------------------------------------- email is off on this server
function EmailOff() {
  const { user } = useAuth();
  return (
    <AuthStatus
      icon="mail"
      tone="warn"
      title="Password reset by email isn't available here"
      actions={
        <>
          {CONTACT_EMAIL && (
            <a className="btn p" href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Ensemblis password reset")}`}>
              <Icon name="mail" />
              Email {CONTACT_EMAIL}
            </a>
          )}
          <Link className={CONTACT_EMAIL ? "btn" : "btn p"} href={ROUTES.login}>
            Back to log in
          </Link>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        This Ensemblis server doesn&apos;t have email set up yet, so it can&apos;t send reset links.{" "}
        {CONTACT_EMAIL ? (
          <>
            Contact the operator at <b style={{ color: "var(--ink)" }}>{CONTACT_EMAIL}</b> and they can reset your password for you.
          </>
        ) : (
          "Contact the person who runs this server and they can reset your password for you."
        )}
      </p>
      {user && !user.isGuest && (
        <p className="small" style={{ margin: "12px 0 0" }}>
          You&apos;re signed in — if you know your current password, you can{" "}
          <Link href={`${ROUTES.settings}#security`} style={{ color: "var(--accent)", fontWeight: 600 }}>
            change it in Settings
          </Link>
          .
        </p>
      )}
    </AuthStatus>
  );
}

// ------------------------------------------------------------- request a link
function ForgotForm() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const emailErr = !email.trim() ? "Enter the email you signed up with" : !EMAIL_RE.test(email.trim()) ? "That doesn't look like an email address" : null;
  const showErr = (submitted || touched) && emailErr;

  const send = async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(address);
      setSentTo(address);
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(errorText(e, "Couldn't send the link. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (emailErr) {
      emailRef.current?.focus();
      return;
    }
    void send(email.trim());
  };

  if (sentTo) {
    return (
      <AuthStatus
        icon="mail"
        tone="ok"
        title="Check your inbox"
        actions={
          <>
            <Link className="btn p" href={ROUTES.login}>
              Back to log in
            </Link>
            <button type="button" className="btn" onClick={() => send(sentTo)} disabled={busy || cooldown > 0} aria-busy={busy}>
              {cooldown > 0 ? `Send again in ${cooldown}s` : "Send again"}
            </button>
          </>
        }
      >
        <p style={{ margin: 0 }} role="status">
          If an account exists for that email, we&apos;ve sent a reset link to <b style={{ color: "var(--ink)", wordBreak: "break-all" }}>{sentTo}</b>.
        </p>
        <ul className="small" style={{ margin: "14px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
          <li>The link works once and expires after an hour.</li>
          <li>Nothing yet? Check your spam folder, or make sure it&apos;s the email you signed up with.</li>
        </ul>
        {error && <FormError>{error}</FormError>}
        <p className="small" style={{ margin: "14px 0 0" }}>
          Wrong address?{" "}
          <button
            type="button"
            onClick={() => {
              setSentTo(null);
              setSubmitted(false);
              setError(null);
              setTimeout(() => emailRef.current?.focus(), 0);
            }}
            style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", fontWeight: 600, cursor: "pointer", font: "inherit" }}
          >
            Use a different email
          </button>
        </p>
      </AuthStatus>
    );
  }

  return (
    <>
      <h1 className="serif" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1.1 }}>
        Forgot your password?
      </h1>
      <p className="muted" style={{ margin: "4px 0 6px" }}>
        Enter your account email and we&apos;ll send you a link to choose a new one.
      </p>
      <form onSubmit={submit} noValidate>
        <Field id="fp-email" label="Email" error={showErr || null}>
          <input
            ref={emailRef}
            id="fp-email"
            className="f"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email.trim() && setTouched(true)}
            aria-invalid={!!showErr}
            aria-describedby={showErr ? "fp-email-err" : undefined}
            placeholder="you@company.com"
          />
        </Field>
        {error && <FormError>{error}</FormError>}
        <button type="submit" className="btn p lg" style={{ width: "100%", marginTop: 20 }} disabled={busy} aria-busy={busy}>
          {busy ? "Sending…" : "Send reset link"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      <p className="small muted" style={{ textAlign: "center", marginTop: 20 }}>
        Remembered it?{" "}
        <Link href={ROUTES.login} style={{ color: "var(--accent)", fontWeight: 600 }}>
          Log in
        </Link>
      </p>
    </>
  );
}
