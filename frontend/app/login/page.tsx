"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, useToast } from "@/components";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { firstName } from "@/lib/format";
import { ROUTES, safeNext, signupUrl } from "@/lib/routes";
import { AuthShell, EMAIL_RE, Field, FormError, PasswordInput } from "./_components/AuthUI";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next");
  const router = useRouter();
  const toast = useToast();
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const dest = (type: "COMPANY" | "DEVELOPER") => safeNext(next, type === "DEVELOPER" ? ROUTES.devDashboard : ROUTES.dashboard);

  // Already signed in → straight through.
  useEffect(() => {
    if (!loading && user && !done.current) router.replace(dest(user.accountType));
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
    if (emailErr || pwErr) return;
    setBusy(true);
    try {
      const { token, user: u } = await api.login({ email: email.trim(), password });
      done.current = true;
      signIn(token, u);
      toast(`Welcome back, ${firstName(u.name)}`);
      router.push(dest(u.accountType));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(err instanceof ApiError && err.status === 401 ? "That email and password don't match an account." : msg);
      setBusy(false);
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
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
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
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={show("password") && !!pwErr}
            aria-describedby={show("password") && pwErr ? "password-err" : undefined}
          />
        </Field>
        {error && <FormError>{error}</FormError>}
        <button type="submit" className="btn p lg" style={{ width: "100%", marginTop: 20 }} disabled={busy} aria-busy={busy}>
          {busy ? "Logging in…" : "Log in"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      <p className="small muted" style={{ textAlign: "center", marginTop: 20 }}>
        New to Ensemblis?{" "}
        <Link href={signupUrl(undefined, next)} style={{ color: "var(--accent)", fontWeight: 600 }}>
          Create an account
        </Link>
      </p>
      <p className="tiny muted" style={{ textAlign: "center", marginTop: 8 }}>
        Demo environment · new accounts get free demo credits, nothing is really charged.
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
