"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon, RolePicker, useToast, type SignupRole } from "@/components";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorText } from "@/lib/errors";
import { PLATFORM_FEE_PERCENT } from "@/lib/data";
import { useConfig } from "@/lib/config";
import { eur, firstName } from "@/lib/format";
import { ROUTES, loginUrl, safeNext, signupUrl } from "@/lib/routes";
import { AuthShell, Divider, EMAIL_RE, Field, FormError, PasswordInput, StrengthMeter } from "../login/_components/AuthUI";

const PERSONA = {
  company: {
    title: "You're hiring AI agents",
    sub: "Confirm a few details — everything here is editable later in Settings.",
    companyLabel: "Company",
    companyPh: "Northstar Labs",
    perk: "{credits} in demo credits preloaded",
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

type Errors = Partial<Record<"name" | "email" | "password" | "invite" | "terms" | "bot", string>>;

function SignupForm() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { user, loading, signIn, signOut, setUser, refresh } = useAuth();
  const next = params.get("next");
  const typeParam = params.get("type");
  const inviteParam = params.get("invite");
  const claimParam = params.get("claim") === "1";
  /** Set once a claim succeeds, so the page keeps its "save" wording while it redirects. */
  const [claimed, setClaimed] = useState(false);
  /** Signed in as a guest-trial account → this form saves the trial (api.claimAccount) instead of signing up. */
  const claim = !!user?.isGuest || claimed;
  /** Keep ?invite= and ?claim= when moving between signup steps. */
  const keepParams = (href: string) => {
    const extra = new URLSearchParams();
    if (inviteParam) extra.set("invite", inviteParam);
    if (claimParam) extra.set("claim", "1");
    const s = extra.toString();
    return s ? `${href}${href.includes("?") ? "&" : "?"}${s}` : href;
  };
  /** Set when the guest session turned out to be expired mid-claim — keep the form on screen. */
  const [lostTrial, setLostTrial] = useState(false);
  // A trial being saved is a company account unless the visitor switches.
  const role: SignupRole | null =
    typeParam === "company" || typeParam === "developer" ? typeParam : claim || claimParam || lostTrial ? "company" : null;
  const dev = role === "developer";
  const { config } = useConfig();
  const inviteRequired = config.inviteRequired && !claim;
  const botCheck = !!config.turnstileSiteKey && !claim;

  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [builds, setBuilds] = useState("");
  const [firstTask, setFirstTask] = useState(params.get("q") || "");
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
    if (!loading && user && !user.isGuest && !done.current) router.replace(safeNext(next, user.accountType === "DEVELOPER" ? ROUTES.devDashboard : ROUTES.dashboard));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  useEffect(() => {
    if (role && !loading) nameRef.current?.focus();
  }, [role, loading]);

  const errors: Errors = {
    name: !name.trim() ? "Tell us your name" : undefined,
    email: !email.trim() ? "Enter your email address" : !EMAIL_RE.test(email.trim()) ? "That doesn't look like an email address" : undefined,
    password: password.length < 8 ? (password ? "Use at least 8 characters" : "Choose a password") : undefined,
    invite: inviteRequired && !invite.trim() ? "Enter your invite code" : undefined,
    terms: !agreed ? "Please agree to the Terms and Privacy Policy to continue" : undefined,
    bot: botCheck && !tsToken ? "Complete the quick security check above" : undefined,
  };
  const show = (k: keyof Errors) => (submitted || touched[k]) && errors[k];
  // Flag a field on blur only once it has content (empty ones are flagged on submit): an error appearing on
  // mousedown would shift the links below and swallow the click.
  const blur = (k: string) => (e: { currentTarget: { value: string } }) => {
    if (e.currentTarget.value.trim()) setTouched((t) => ({ ...t, [k]: true }));
  };

  // Until we know whether this visitor is a guest, don't flash the wrong form.
  if (loading) {
    return (
      <AuthShell>
        <div aria-busy="true" aria-label="Loading">
          <div className="sk" style={{ height: 30, width: "70%" }} />
          <div className="sk" style={{ height: 14, width: "90%", marginTop: 12 }} />
          <div className="sk" style={{ height: 44, marginTop: 24 }} />
          <div className="sk" style={{ height: 44, marginTop: 14 }} />
          <div className="sk" style={{ height: 44, marginTop: 14 }} />
        </div>
      </AuthShell>
    );
  }

  if (!role) {
    return (
      <AuthShell wide>
        <h1 className="serif" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.03em" }}>
          Welcome to Ensemblis
        </h1>
        <p className="muted" style={{ margin: "4px 0 22px" }}>
          How will you use it today?
        </p>
        <RolePicker onPick={(r) => router.replace(keepParams(signupUrl(r, next)))} />
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
      accountType: dev ? ("DEVELOPER" as const) : ("COMPANY" as const),
      builds: dev ? builds.trim() || undefined : undefined,
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
      if (!dev && jobRole.trim()) {
        try {
          const r = await api.updateMe({ role: jobRole.trim() });
          setUser(r.user);
        } catch {
          /* non-blocking: role can be set later in Settings */
        }
      }
      if (wasClaim) {
        toast(`Your trial results are saved — welcome, ${firstName(u.name)}`, { icon: "check" });
        router.push(safeNext(next, ROUTES.dashboard));
        return;
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
      if (!wasClaim) ts.current?.reset(); // Turnstile tokens are single-use
      const status = err instanceof ApiError ? err.status : -1;
      if (wasClaim && status === 401) {
        // The guest account is gone (trial expired) — nothing left to save.
        setLostTrial(true);
        signOut();
        setFormError("Your free trial has expired, so there's nothing left to save. You can still create a fresh account below.");
        return;
      }
      if (wasClaim && status === 409 && /already registered/i.test(errorText(err))) {
        // Saved already (e.g. in another tab): pick up the real account.
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
        // Invite missing/invalid, or signups closed on this demo — show the server's reason inline.
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

  const other: SignupRole = dev ? "company" : "developer";
  const title = claim ? "Save your trial results" : P.title;
  const sub = claim
    ? "Create your free account — your trial task and report come with you, nothing to redo."
    : P.sub;

  return (
    <AuthShell>
      <div key={`${role}-${claim ? "claim" : "new"}`} className="reveal">
        {claim && (
          <span className="tag ok">
            <Icon name="check" />
            Free trial in progress
          </span>
        )}
        <h1 className="serif" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1.1, marginTop: claim ? 10 : 0 }}>
          {title}
        </h1>
        <p className="muted" style={{ margin: "4px 0 4px" }}>
          {sub}
        </p>
        {claimParam && !claim && !lostTrial && (
          <div className="notice" style={{ marginTop: 12, background: "var(--surface2)", color: "var(--muted)" }}>
            <Icon name="info" />
            <span>
              We couldn&apos;t find a free-trial session in this browser, so this creates a new account. Trial results stay in the browser where the trial was started.
            </span>
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
              {!claim && (
                <Field id="su-task" label="What do you need done first?" optional hint="We'll take you straight to planning it.">
                  <input id="su-task" className="f" value={firstTask} onChange={(e) => setFirstTask(e.target.value)} placeholder="e.g. Analyze our top 20 competitors…" maxLength={8000} />
                </Field>
              )}
            </>
          )}
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
            <Field id="su-invite" label="Invite code" error={inviteError || show("invite")} hint="This demo is invite-only for now. Your code came with your invitation link.">
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
                placeholder="e.g. ENSEMBLIS-2026"
                maxLength={120}
              />
            </Field>
          )}

          <div className="dcard" style={{ marginTop: 18 }}>
            <div className="row" style={{ gap: 10 }}>
              <div style={{ color: "var(--accent)" }}>
                <Icon name={claim ? "check" : P.perkIcon} />
              </div>
              <div className="sp">
                <b className="small">{claim ? "Your trial task and report move to your new account" : P.perk.replace("{credits}", eur(config.startingCreditsCents))}</b>
                <div className="tiny muted">{claim ? "Saved for good — no more 7-day limit" : "Demo environment · no real charges"}</div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <label htmlFor="su-terms" className="small" style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", lineHeight: 1.45 }}>
              <input
                id="su-terms"
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                required
                aria-describedby="su-terms-note"
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
            <div className="tiny muted" id="su-terms-note" style={{ marginTop: 4, paddingLeft: 28 }}>
              {agreed ? (claim ? "Thanks — you can save your account now." : "Thanks — you can create your account now.") : "Required to create an account."}
            </div>
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

          <button type="submit" className="btn p lg" style={{ width: "100%", marginTop: 16 }} disabled={busy || !agreed} aria-busy={busy}>
            {busy ? (claim ? "Saving your trial…" : "Creating your account…") : claim ? "Save my results" : "Create account"}
            {!busy && <Icon name="arrow" />}
          </button>
        </form>
        <Divider>or</Divider>
        <div className="row between wrapflex small" style={{ gap: 8 }}>
          <Link href={loginUrl(next)} className="muted">
            Already have an account? <b style={{ color: "var(--accent)" }}>Log in</b>
            {claim && <span className="tiny" style={{ display: "block" }}>Logging in ends this trial session.</span>}
          </Link>
          <Link href={keepParams(signupUrl(other, next))} replace className="muted">
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
