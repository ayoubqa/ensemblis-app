"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, RolePicker, useToast, type SignupRole } from "@/components";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PLATFORM_FEE_PERCENT, STARTING_CREDITS_CENTS } from "@/lib/data";
import { eur, firstName } from "@/lib/format";
import { ROUTES, loginUrl, safeNext, signupUrl } from "@/lib/routes";
import { AuthShell, Divider, EMAIL_RE, Field, FormError, PasswordInput, StrengthMeter } from "../login/_components/AuthUI";

const PERSONA = {
  company: {
    title: "You're hiring AI agents",
    sub: "Confirm a few details — everything here is editable later in Settings.",
    companyLabel: "Company",
    companyPh: "Northstar Labs",
    perk: `${eur(STARTING_CREDITS_CENTS)} in demo credits preloaded`,
    perkIcon: "eur" as const,
  },
  developer: {
    title: "You're building agents",
    sub: "Confirm a few details — everything here is editable later in Settings.",
    companyLabel: "Studio / team name",
    companyPh: "DataLabs",
    perk: `Earn ${100 - PLATFORM_FEE_PERCENT}% of every task your agents complete`,
    perkIcon: "spark" as const,
  },
};

type Errors = Partial<Record<"name" | "email" | "password", string>>;

function SignupForm() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { user, loading, signIn, setUser } = useAuth();
  const next = params.get("next");
  const typeParam = params.get("type");
  const role: SignupRole | null = typeParam === "company" || typeParam === "developer" ? typeParam : null;
  const dev = role === "developer";

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [builds, setBuilds] = useState("");
  const [firstTask, setFirstTask] = useState(params.get("q") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const done = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && user && !done.current) router.replace(safeNext(next, user.accountType === "DEVELOPER" ? ROUTES.devDashboard : ROUTES.dashboard));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  useEffect(() => {
    if (role) nameRef.current?.focus();
  }, [role]);

  const errors: Errors = {
    name: !name.trim() ? "Tell us your name" : undefined,
    email: !email.trim() ? "Enter your email address" : !EMAIL_RE.test(email.trim()) ? "That doesn't look like an email address" : undefined,
    password: password.length < 8 ? (password ? "Use at least 8 characters" : "Choose a password") : undefined,
  };
  const show = (k: keyof Errors) => (submitted || touched[k]) && errors[k];
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));

  if (!role) {
    return (
      <AuthShell wide>
        <h1 className="serif" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.03em" }}>
          Welcome to Ensemblis
        </h1>
        <p className="muted" style={{ margin: "4px 0 22px" }}>
          How will you use it today?
        </p>
        <RolePicker onPick={(r) => router.replace(signupUrl(r, next))} />
        <p className="small muted" style={{ textAlign: "center", marginTop: 20 }}>
          Already have an account?{" "}
          <Link href={loginUrl(next)} style={{ color: "var(--accent)", fontWeight: 600 }}>
            Log in
          </Link>
        </p>
        <p className="tiny muted" style={{ textAlign: "center", marginTop: 8 }}>
          This is a self-serve product demo. No payment is required either way.
        </p>
      </AuthShell>
    );
  }

  const P = PERSONA[role];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    setEmailTaken(false);
    if (errors.name || errors.email || errors.password) {
      const first = (["name", "email", "password"] as const).find((k) => errors[k]);
      if (first) document.getElementById(first === "name" ? "su-name" : first === "email" ? "su-email" : "su-password")?.focus();
      return;
    }
    setBusy(true);
    try {
      const { token, user: u } = await api.signup({
        email: email.trim(),
        password,
        name: name.trim(),
        company: company.trim() || undefined,
        accountType: dev ? "DEVELOPER" : "COMPANY",
        builds: dev ? builds.trim() || undefined : undefined,
      });
      done.current = true;
      signIn(token, u);
      if (!dev && jobRole.trim()) {
        try {
          const r = await api.updateMe({ role: jobRole.trim() });
          setUser(r.user);
        } catch {
          /* non-blocking: role can be set later in Settings */
        }
      }
      toast(`Welcome to Ensemblis, ${firstName(u.name)}`);
      setTimeout(
        () => toast.info(dev ? "Your developer dashboard is ready — publish your first agent next." : `${eur(u.credits)} in demo credits preloaded — nothing is ever really charged.`, { icon: dev ? "spark" : "eur" }),
        1400
      );
      const fallback = dev ? ROUTES.devDashboard : firstTask.trim() ? `${ROUTES.newTask}?q=${encodeURIComponent(firstTask.trim())}` : ROUTES.dashboard;
      router.push(safeNext(next, fallback));
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409) {
        setEmailTaken(true);
        document.getElementById("su-email")?.focus();
        return;
      }
      setFormError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const other: SignupRole = dev ? "company" : "developer";

  return (
    <AuthShell>
      <div key={role} className="reveal">
        <h1 className="serif" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1.1 }}>
          {P.title}
        </h1>
        <p className="muted" style={{ margin: "4px 0 4px" }}>
          {P.sub}
        </p>
        <form onSubmit={submit} noValidate>
          <Field id="su-name" label="Your name" error={show("name")}>
            <input
              ref={nameRef}
              id="su-name"
              className="f"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={blur("name")}
              aria-invalid={!!show("name")}
              aria-describedby={show("name") ? "su-name-err" : undefined}
              placeholder={dev ? "Jordan Lee" : "Alex Morgan"}
              maxLength={120}
            />
          </Field>
          <Field id="su-company" label={P.companyLabel} optional>
            <input id="su-company" className="f" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} placeholder={P.companyPh} maxLength={160} />
          </Field>
          {dev ? (
            <Field id="su-builds" label="What do your agents do?" optional hint="Shown on your developer profile.">
              <input
                id="su-builds"
                className="f"
                value={builds}
                onChange={(e) => setBuilds(e.target.value)}
                placeholder="e.g. Competitive intelligence, lead research…"
                maxLength={500}
              />
            </Field>
          ) : (
            <>
              <Field id="su-role" label="Your role" optional>
                <input id="su-role" className="f" autoComplete="organization-title" value={jobRole} onChange={(e) => setJobRole(e.target.value)} placeholder="Founder" maxLength={120} />
              </Field>
              <Field id="su-task" label="What do you need done first?" optional hint="We'll take you straight to planning it.">
                <input id="su-task" className="f" value={firstTask} onChange={(e) => setFirstTask(e.target.value)} placeholder="e.g. Analyze our top 20 competitors…" maxLength={8000} />
              </Field>
            </>
          )}
          <Field
            id="su-email"
            label="Work email"
            error={
              emailTaken ? (
                <>
                  An account with that email already exists.{" "}
                  <Link href={loginUrl(next)} style={{ fontWeight: 600, textDecoration: "underline" }}>
                    Log in instead
                  </Link>
                </>
              ) : (
                show("email")
              )
            }
          >
            <input
              id="su-email"
              className="f"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailTaken(false);
              }}
              onBlur={blur("email")}
              aria-invalid={emailTaken || !!show("email")}
              aria-describedby={emailTaken || show("email") ? "su-email-err" : undefined}
              placeholder="you@company.com"
            />
          </Field>
          <Field id="su-password" label="Password" error={show("password")}>
            <PasswordInput
              id="su-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={blur("password")}
              aria-invalid={!!show("password")}
              aria-describedby={show("password") ? "su-password-err" : undefined}
              minLength={8}
            />
            {!show("password") && <StrengthMeter pw={password} />}
          </Field>

          <div className="dcard" style={{ marginTop: 18 }}>
            <div className="row" style={{ gap: 10 }}>
              <div style={{ color: "var(--accent)" }}>
                <Icon name={P.perkIcon} />
              </div>
              <div className="sp">
                <b className="small">{P.perk}</b>
                <div className="tiny muted">Demo environment · no real charges</div>
              </div>
            </div>
          </div>

          {formError && <FormError>{formError}</FormError>}

          <button type="submit" className="btn p lg" style={{ width: "100%", marginTop: 16 }} disabled={busy} aria-busy={busy}>
            {busy ? "Creating your account…" : "Create account"}
            {!busy && <Icon name="arrow" />}
          </button>
        </form>
        <Divider>or</Divider>
        <div className="row between wrapflex small" style={{ gap: 8 }}>
          <Link href={loginUrl(next)} className="muted">
            Already have an account? <b style={{ color: "var(--accent)" }}>Log in</b>
          </Link>
          <Link href={signupUrl(other, next)} replace className="muted">
            {dev ? "Hiring agents instead?" : "Building agents instead?"} <b style={{ color: "var(--ink)" }}>Switch</b>
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<AuthShell>{<div className="sk" style={{ height: 320 }} />}</AuthShell>}>
      <SignupForm />
    </Suspense>
  );
}
