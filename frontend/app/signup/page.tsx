"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, useToast } from "@/components";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorText } from "@/lib/errors";
import { useConfig } from "@/lib/config";
import { firstName } from "@/lib/format";
import { ROUTES, loginUrl, safeNext } from "@/lib/routes";
import { AuthShell, Divider, EMAIL_RE, Field, FormError, PasswordInput, StrengthMeter } from "../login/_components/AuthUI";

type Errors = Partial<Record<"name" | "email" | "password" | "invite" | "terms" | "bot", string>>;

function SignupForm() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { user, loading, signIn, signOut, refresh } = useAuth();
  const next = params.get("next");
  const claimParam = params.get("claim") === "1";
  /** Set once a claim succeeds, so the page keeps its "save" wording while it redirects. */
  const [claimed, setClaimed] = useState(false);
  /** Signed in as a guest-trial account → this form saves the trial (api.claimAccount) instead of signing up. */
  const claim = !!user?.isGuest || claimed;
  /** Set when the guest session turned out to be expired mid-claim — keep the form on screen. */
  const [lostTrial, setLostTrial] = useState(false);
  const { config } = useConfig();
  const inviteRequired = config.inviteRequired && !claim;
  const botCheck = !!config.turnstileSiteKey && !claim;

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState(params.get("invite") || "");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [tsToken, setTsToken] = useState<string | null>(null);
  const ts = useRef<TurnstileHandle>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState<string | null>(null);
  const done = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Real accounts don't need this page; guests stay to save their trial.
  useEffect(() => {
    if (!loading && user && !user.isGuest && !done.current) router.replace(safeNext(next, ROUTES.dashboard));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  useEffect(() => {
    if (!loading) nameRef.current?.focus();
  }, [loading]);

  const errors: Errors = {
    name: !name.trim() ? "Tell us your name" : undefined,
    email: !email.trim() ? "Enter your email address" : !EMAIL_RE.test(email.trim()) ? "That doesn't look like an email address" : undefined,
    password: password.length < 8 ? (password ? "Use at least 8 characters" : "Choose a password") : undefined,
    invite: inviteRequired && !invite.trim() ? "Enter your invite code" : undefined,
    terms: !agreed ? "Please agree to the Terms and Privacy Policy to continue" : undefined,
    bot: botCheck && !tsToken ? "Complete the quick security check above" : undefined,
  };
  const show = (k: keyof Errors) => (submitted || touched[k]) && errors[k];
  // Flag a field on blur only once it has content (empty ones are flagged on submit).
  const blur = (k: string) => (e: { currentTarget: { value: string } }) => {
    if (e.currentTarget.value.trim()) setTouched((t) => ({ ...t, [k]: true }));
  };

  if (loading) {
    return (
      <AuthShell>
        <div aria-busy="true" aria-label="Loading">
          <div className="sk" style={{ height: 30, width: "70%" }} />
          <div className="sk" style={{ height: 14, width: "90%", marginTop: 12 }} />
          <div className="sk" style={{ height: 44, marginTop: 24 }} />
          <div className="sk" style={{ height: 44, marginTop: 14 }} />
        </div>
      </AuthShell>
    );
  }

  const ORDER = ["name", "email", "password", "invite", "terms"] as const;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    setEmailTaken(null);
    setInviteError(null);
    const first = ORDER.find((k) => errors[k]);
    if (first) {
      document.getElementById(`su-${first}`)?.focus();
      return;
    }
    if (errors.bot) return;
    setBusy(true);
    const wasClaim = claim;
    const profile = {
      email: email.trim(),
      password,
      name: name.trim(),
      company: company.trim() || undefined,
      acceptedTerms: true as const,
    };
    try {
      const { token, user: u } = wasClaim
        ? await api.claimAccount(profile)
        : await api.signup({
            ...profile,
            ...(inviteRequired || invite.trim() ? { inviteCode: invite.trim() } : {}),
            ...(tsToken ? { turnstileToken: tsToken } : {}),
          });
      done.current = true;
      if (wasClaim) setClaimed(true);
      signIn(token, u);
      toast(wasClaim ? `Your trial work is saved — welcome, ${firstName(u.name)}` : `Welcome to Ensemblis, ${firstName(u.name)}`, { icon: "check" });
      if (!u.emailVerified) setTimeout(() => toast.info("We sent you a link to verify your email address."), 1400);
      router.push(safeNext(next, wasClaim ? ROUTES.dashboard : ROUTES.context));
    } catch (err) {
      setBusy(false);
      if (!wasClaim) ts.current?.reset(); // Turnstile tokens are single-use
      const status = err instanceof ApiError ? err.status : -1;
      if (wasClaim && status === 401) {
        setLostTrial(true);
        signOut();
        setFormError("Your free trial has expired, so there's nothing left to save. You can still create a fresh account below.");
        return;
      }
      if (wasClaim && status === 409 && /already registered/i.test(errorText(err))) {
        await refresh();
        toast("This trial is already saved to an account");
        router.push(safeNext(next, ROUTES.dashboard));
        return;
      }
      if (status === 409) {
        setEmailTaken(errorText(err, "An account with that email already exists."));
        document.getElementById("su-email")?.focus();
        return;
      }
      if (!wasClaim && status === 403) {
        const msg = errorText(err, "Signups need a valid invite code right now.");
        if (inviteRequired || invite.trim()) {
          setInviteError(msg);
          document.getElementById("su-invite")?.focus();
        } else setFormError(msg);
        return;
      }
      setFormError(errorText(err));
    }
  };

  return (
    <AuthShell>
      <div className="reveal">
        {claim && (
          <span className="tag ok">
            <Icon name="check" />
            Free trial in progress
          </span>
        )}
        <h1 style={{ fontSize: 28, fontWeight: 650, letterSpacing: "-.03em", lineHeight: 1.1, marginTop: claim ? 10 : 0 }}>
          {claim ? "Save your trial work" : "Create your organization"}
        </h1>
        <p className="muted" style={{ margin: "4px 0 4px" }}>
          {claim
            ? "Create your account — your trial objective and its results come with you."
            : "Your AI Team — a Chief of Staff and four executives — is ready as soon as you sign up."}
        </p>
        {claimParam && !claim && !lostTrial && (
          <div className="notice" style={{ marginTop: 12, background: "var(--surface2)", color: "var(--muted)" }}>
            <Icon name="info" />
            <span>We couldn&apos;t find a free-trial session in this browser, so this creates a new account.</span>
          </div>
        )}
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
              placeholder="Alex Morgan"
              maxLength={120}
            />
          </Field>
          <Field id="su-company" label="Company" optional hint="Names your organization and starts your Company Context.">
            <input id="su-company" className="f" autoComplete="organization" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Northstar Labs" maxLength={160} />
          </Field>
          <Field
            id="su-email"
            label="Work email"
            error={
              emailTaken ? (
                <>
                  {emailTaken}{" "}
                  {!claim && (
                    <Link href={loginUrl(next)} style={{ fontWeight: 600, textDecoration: "underline" }}>
                      Log in instead
                    </Link>
                  )}
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
                setEmailTaken(null);
              }}
              onBlur={blur("email")}
              aria-invalid={!!emailTaken || !!show("email")}
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
          {inviteRequired && (
            <Field id="su-invite" label="Invite code" error={inviteError || show("invite")} hint="Access is invite-only for now. Your code came with your invitation.">
              <input
                id="su-invite"
                className="f"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={invite}
                onChange={(e) => {
                  setInvite(e.target.value);
                  setInviteError(null);
                }}
                onBlur={blur("invite")}
                aria-invalid={!!inviteError || !!show("invite")}
                aria-describedby={inviteError || show("invite") ? "su-invite-err" : "su-invite-hint"}
                maxLength={120}
              />
            </Field>
          )}

          <div style={{ marginTop: 16 }}>
            <label htmlFor="su-terms" className="small" style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", lineHeight: 1.45 }}>
              <input
                id="su-terms"
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                required
                style={{ width: 18, height: 18, marginTop: 1, flex: "none", accentColor: "var(--accent)" }}
              />
              <span>
                I agree to the{" "}
                <a href={ROUTES.terms} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}>
                  Terms<span className="sr-only"> (opens in a new tab)</span>
                </a>{" "}
                and{" "}
                <a href={ROUTES.privacy} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline" }}>
                  Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </span>
            </label>
            {submitted && errors.terms && (
              <div className="err" role="alert" style={{ paddingLeft: 28 }}>
                {errors.terms}
              </div>
            )}
          </div>

          {botCheck && (
            <>
              <Turnstile ref={ts} onToken={setTsToken} action="signup" />
              {submitted && errors.bot && (
                <div className="err" role="alert">
                  {errors.bot}
                </div>
              )}
            </>
          )}

          {formError && <FormError>{formError}</FormError>}

          <button type="submit" className="btn p lg" style={{ width: "100%", marginTop: 16 }} disabled={busy} aria-busy={busy} data-testid="signup-submit">
            {busy ? (claim ? "Saving…" : "Creating your organization…") : claim ? "Save my work" : "Create account"}
            {!busy && <Icon name="arrow" />}
          </button>
        </form>
        <Divider>or</Divider>
        <p className="small muted" style={{ textAlign: "center" }}>
          <Link href={loginUrl(next)}>
            Already have an account? <b style={{ color: "var(--accent)" }}>Log in</b>
          </Link>
          {claim && <span className="tiny" style={{ display: "block" }}>Logging in ends this trial session.</span>}
        </p>
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
