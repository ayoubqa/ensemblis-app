"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, useToast } from "@/components";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { errorText } from "@/lib/errors";
import { firstName } from "@/lib/format";
import { ROUTES, safeNext, signupUrl } from "@/lib/routes";
import { AuthShell, EMAIL_RE, Field, FormError, PasswordInput } from "./_components/AuthUI";

/** The server refuses password sign-in for guest-trial accounts (403). */
function isGuestAccountError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 403 && /guest|trial/i.test(e.message);
}

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next");
  const router = useRouter();
  const toast = useToast();
  const { user, loading, signIn } = useAuth();
  const { config } = useConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const done = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const dest = () => safeNext(next, ROUTES.dashboard);

  // Already signed in → straight through (a guest may still log in to a real account).
  useEffect(() => {
    if (!loading && user && !user.isGuest && !done.current) router.replace(dest());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const emailErr = !email.trim() ? "Enter your email address" : !EMAIL_RE.test(email.trim()) ? "That doesn't look like an email address" : null;
  const pwErr = !password ? "Enter your password" : null;
  const show = (k: "email" | "password") => submitted || touched[k];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    setGuestError(null);
    if (emailErr || pwErr) return;
    setBusy(true);
    try {
      const { token, user: u } = await api.login({ email: email.trim(), password });
      done.current = true;
      signIn(token, u);
      toast(`Welcome back, ${firstName(u.name)}`);
      router.push(dest());
    } catch (err) {
      setBusy(false);
      if (isGuestAccountError(err)) {
        setGuestError(errorText(err));
        return;
      }
      setError(err instanceof ApiError && err.status === 401 ? "That email and password don't match an account." : errorText(err));
    }
  };

  return (
    <AuthShell>
      <h1 className="serif" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1.1 }}>
        Welcome back
      </h1>
      <p className="muted" style={{ margin: "4px 0 6px" }}>
        {next && next !== "/" ? "Log in to continue where you left off." : "Log in to your Ensemblis account."}
      </p>
      {user?.isGuest && (
        <div className="notice" style={{ marginTop: 12, background: "var(--accent-soft)", color: "var(--ink)" }}>
          <Icon name="info" />
          <span>
            You&apos;re in a free-trial session. Logging in to another account ends it —{" "}
            <Link href={`${ROUTES.signup}?claim=1`} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}>
              save your trial results first
            </Link>
            .
          </span>
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <Field id="email" label="Email" error={show("email") ? emailErr : null}>
          <input
            ref={emailRef}
            id="email"
            className="f"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email.trim() && setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={show("email") && !!emailErr}
            aria-describedby={show("email") && emailErr ? "email-err" : undefined}
            placeholder="you@company.com"
          />
        </Field>
        <Field id="password" label="Password" error={show("password") ? pwErr : null}>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => password && setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={show("password") && !!pwErr}
            aria-describedby={show("password") && pwErr ? "password-err" : undefined}
          />
        </Field>
        {config.emailEnabled && (
          <div style={{ textAlign: "right", marginTop: 8 }}>
            <Link href={ROUTES.forgotPassword} className="small" style={{ color: "var(--accent)", fontWeight: 600 }}>
              Forgot password?
            </Link>
          </div>
        )}
        {guestError && (
          <div className="notice" role="alert" style={{ marginTop: 16, background: "var(--accent-soft)", color: "var(--ink)", alignItems: "flex-start" }}>
            <Icon name="info" />
            <span>
              <b style={{ display: "block", marginBottom: 2 }}>That&apos;s a free-trial account</b>
              {guestError}{" "}
              <Link href={signupUrl(next)} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}>
                Sign up free
              </Link>
            </span>
          </div>
        )}
        {error && <FormError>{error}</FormError>}
        <button type="submit" className="btn p lg" style={{ width: "100%", marginTop: 20 }} disabled={busy} aria-busy={busy}>
          {busy ? "Logging in…" : "Log in"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      <p className="small muted" style={{ textAlign: "center", marginTop: 20 }}>
        New to Ensemblis?{" "}
        <Link href={signupUrl(next)} style={{ color: "var(--accent)", fontWeight: 600 }}>
          Create an account
        </Link>
        {config.guestTrialEnabled && !user && (
          <>
            {" "}
            or{" "}
            <Link href={`${ROUTES.home}?trial=1`} style={{ color: "var(--accent)", fontWeight: 600 }}>
              try it without an account
            </Link>
          </>
        )}
      </p>
      <p className="tiny muted" style={{ textAlign: "center", marginTop: 8 }}>
        Usage-based · nothing runs or is charged without your approval.
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthShell>{<div className="sk" style={{ height: 220 }} />}</AuthShell>}>
      <LoginForm />
    </Suspense>
  );
}
