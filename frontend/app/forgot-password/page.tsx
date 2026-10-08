"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CONTACT_EMAIL, useConfig } from "@/lib/config";
import { ROUTES } from "@/lib/routes";
import { AuthHead, AuthLoading, AuthShell, AuthStatus, EMAIL_RE, Field, FormError, authErrorText, useAutoFocus } from "../login/_components/AuthUI";

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
        <AuthLoading lines={1} />
      </AuthShell>
    );
  }

  return <AuthShell>{loaded && !config.emailEnabled ? <EmailOff /> : <ForgotForm />}</AuthShell>;
}

// ------------------------------------------------------------- email is off on this deployment
function EmailOff() {
  const { user } = useAuth();
  return (
    <AuthStatus
      icon="mail"
      tone="warn"
      title="Password reset by email isn't available yet"
      actions={
        <>
          {CONTACT_EMAIL && (
            <a className="btn p" href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Ensemblis password reset")}`}>
              <Icon name="mail" />
              Email support
            </a>
          )}
          <Link className={CONTACT_EMAIL ? "btn" : "btn p"} href={ROUTES.login}>
            Back to log in
          </Link>
        </>
      }
    >
      <p>
        Ensemblis can&apos;t send password reset emails at the moment.{" "}
        {CONTACT_EMAIL ? (
          <>
            Write to <b>{CONTACT_EMAIL}</b> from the address on your account and we&apos;ll help you reset your password.
          </>
        ) : (
          "Contact your Ensemblis administrator to reset your password."
        )}
      </p>
      {user && !user.isGuest && (
        <p>
          You&apos;re logged in, so if you know your current password you can <Link href={`${ROUTES.settings}#security`}>change it in Settings</Link>.
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

  useAutoFocus(emailRef);

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
      setError(authErrorText(e, "Couldn't send the link. Please try again."));
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
        <p>
          If an account exists for that email, we&apos;ve sent a reset link to <b>{sentTo}</b>.
        </p>
        <ul className="au-points">
          <li>
            <Icon name="clock" />
            <span>The link works once and expires after an hour.</span>
          </li>
          <li>
            <Icon name="inbox" />
            <span>Nothing yet? Check your spam folder, or make sure it&apos;s the email you signed up with.</span>
          </li>
        </ul>
        {error && <FormError>{error}</FormError>}
        <p>
          Wrong address?{" "}
          <button
            type="button"
            className="au-textbtn"
            onClick={() => {
              setSentTo(null);
              setSubmitted(false);
              setError(null);
              setTimeout(() => emailRef.current?.focus(), 0);
            }}
          >
            Use a different email
          </button>
        </p>
      </AuthStatus>
    );
  }

  return (
    <>
      <AuthHead title="Forgot your password?">Enter your account email and we&apos;ll send you a link to choose a new one.</AuthHead>
      <form onSubmit={submit} noValidate>
        <Field id="fp-email" label="Email" error={showErr || null}>
          <input
            ref={emailRef}
            id="fp-email"
            className="f"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email.trim() && setTouched(true)}
            aria-invalid={!!showErr}
            aria-describedby={showErr ? "fp-email-err" : undefined}
            placeholder="you@company.com"
          />
        </Field>
        {error && <FormError>{error}</FormError>}
        <button type="submit" className="btn p lg au-submit" disabled={busy} aria-busy={busy}>
          {busy ? "Sending…" : "Send reset link"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      <div className="au-alt">
        <p>
          Remembered it? <Link href={ROUTES.login}>Log in</Link>
        </p>
      </div>
    </>
  );
}
