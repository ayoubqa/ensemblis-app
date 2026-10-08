"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, useToast } from "@/components";
import { claimUrl } from "@/components/GuestBanner";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { firstName } from "@/lib/format";
import { ROUTES, safeNext, signupUrl } from "@/lib/routes";
import { AuthHead, AuthLoading, AuthNotice, AuthShell, EMAIL_RE, Field, FormError, PasswordInput, authErrorText, useAutoFocus } from "./_components/AuthUI";

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

  // A signed-in member is on their way elsewhere (or just logged in): don't flash the form.
  const leaving = loading || (!!user && !user.isGuest);
  useAutoFocus(emailRef, !leaving);

  const emailErr = !email.trim() ? "Enter your email address" : !EMAIL_RE.test(email.trim()) ? "That doesn't look like an email address" : null;
  const pwErr = !password ? "Enter your password" : null;
  const show = (k: "email" | "password") => submitted || touched[k];
  const emailShown = show("email") && !!emailErr;
  const pwShown = show("password") && !!pwErr;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    setGuestError(null);
    if (emailErr || pwErr) {
      document.getElementById(emailErr ? "email" : "password")?.focus();
      return;
    }
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
        setGuestError(authErrorText(err));
        return;
      }
      setError(err instanceof ApiError && err.status === 401 ? "That email and password don't match an account." : authErrorText(err));
    }
  };

  if (leaving) {
    return (
      <AuthShell>
        <AuthLoading label={done.current ? "Logging you in…" : "Loading…"} lines={2} />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHead title="Welcome back">{next && next !== "/" ? "Log in to continue where you left off." : "Log in to your Ensemblis account."}</AuthHead>
      {user?.isGuest && (
        <AuthNotice title="You're in a free trial">
          Logging in to another account ends it. <Link href={claimUrl()}>Save your trial work first</Link>.
        </AuthNotice>
      )}
      <form onSubmit={submit} noValidate>
        <Field id="email" label="Email" error={emailShown ? emailErr : null}>
          <input
            ref={emailRef}
            id="email"
            className="f"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email.trim() && setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={emailShown}
            aria-describedby={emailShown ? "email-err" : undefined}
            placeholder="you@company.com"
          />
        </Field>
        <Field
          id="password"
          label="Password"
          error={pwShown ? pwErr : null}
          aside={
            <Link href={ROUTES.forgotPassword} className="au-link">
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => password && setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={pwShown}
            aria-describedby={pwShown ? "password-err" : undefined}
          />
        </Field>
        {guestError && (
          <AuthNotice title="That's a free-trial account" alert>
            {guestError} <Link href={signupUrl(next)}>Create an account</Link>
          </AuthNotice>
        )}
        {error && <FormError>{error}</FormError>}
        <button type="submit" className="btn p lg au-submit" disabled={busy} aria-busy={busy}>
          {busy ? "Logging in…" : "Log in"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      <div className="au-alt">
        <p>
          New to Ensemblis? <Link href={signupUrl(next)}>Create an account</Link>
        </p>
        {config.guestTrialEnabled && !user && (
          <p>
            Or <Link href={`${ROUTES.home}?trial=1`}>try it without an account</Link>
          </p>
        )}
      </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthShell>
          <AuthLoading lines={2} />
        </AuthShell>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
