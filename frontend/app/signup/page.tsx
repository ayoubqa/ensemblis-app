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
import { AuthHead, AuthLoading, AuthNotice, AuthShell, EMAIL_RE, Field, FormError, PasswordInput, StrengthMeter, authErrorText, useAutoFocus } from "../login/_components/AuthUI";

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

  const redirecting = !!user && !user.isGuest && !done.current;
  useAutoFocus(nameRef, !loading && !redirecting);

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

  if (loading || redirecting) {
    return (
      <AuthShell intro="next" stepsOnMobile>
        <AuthLoading lines={4} />
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
      // Only claim a verification email went out when this deployment actually sends email.
      if (!u.emailVerified && config.emailEnabled) setTimeout(() => toast.info("We sent you a link to verify your email address."), 1400);
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
      setFormError(authErrorText(err));
    }
  };

  const nameErr = show("name");
  const emailErr = !!emailTaken || !!show("email");
  const pwErr = show("password");
  const inviteErr = inviteError || show("invite");
  const termsErr = submitted && errors.terms;
  const pwStrength = !pwErr && password ? "su-password-strength" : undefined;

  return (
    <AuthShell intro="next" stepsOnMobile>
      <AuthHead
        title={claim ? "Save your trial work" : "Create your organization"}
        tag={
          claim ? (
            <span className="tag ok">
              <Icon name="check" />
              Free trial in progress
            </span>
          ) : undefined
        }
      >
        {claim
          ? "Create your account. Your trial objective and everything it produced come with you."
          : "Your AI Team — a Chief of Staff and four executives — is ready as soon as you sign up."}
      </AuthHead>
      {claimParam && !claim && !lostTrial && (
        <AuthNotice tone="neutral">We couldn&apos;t find a free-trial session in this browser, so this creates a new account.</AuthNotice>
      )}
      <form onSubmit={submit} noValidate>
        <Field id="su-name" label="Your name" error={nameErr}>
          <input
            ref={nameRef}
            id="su-name"
            className="f"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={blur("name")}
            aria-invalid={!!nameErr}
            aria-describedby={nameErr ? "su-name-err" : undefined}
            maxLength={120}
          />
        </Field>
        <Field id="su-company" label="Company" optional hint="Names your organization and starts your Company Context.">
          <input
            id="su-company"
            className="f"
            autoComplete="organization"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            aria-describedby="su-company-hint"
            maxLength={160}
          />
        </Field>
        <Field
          id="su-email"
          label="Work email"
          error={
            emailTaken ? (
              <>
                {emailTaken} {!claim && <Link href={loginUrl(next)}>Log in instead</Link>}
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
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailTaken(null);
            }}
            onBlur={blur("email")}
            aria-invalid={emailErr}
            aria-describedby={emailErr ? "su-email-err" : undefined}
            placeholder="you@company.com"
          />
        </Field>
        <Field id="su-password" label="Password" error={pwErr} hint={!password ? "At least 8 characters." : undefined}>
          <PasswordInput
            id="su-password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={blur("password")}
            aria-invalid={!!pwErr}
            aria-describedby={pwErr ? "su-password-err" : pwStrength ?? "su-password-hint"}
            minLength={8}
          />
          {!pwErr && <StrengthMeter pw={password} id="su-password-strength" />}
        </Field>
        {inviteRequired && (
          <Field id="su-invite" label="Invite code" error={inviteErr} hint="Access is invite-only for now. Your code came with your invitation.">
            <input
              id="su-invite"
              className="f"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              value={invite}
              onChange={(e) => {
                setInvite(e.target.value);
                setInviteError(null);
              }}
              onBlur={blur("invite")}
              aria-invalid={!!inviteErr}
              aria-describedby={inviteErr ? "su-invite-err" : "su-invite-hint"}
              maxLength={120}
            />
          </Field>
        )}

        <label htmlFor="su-terms" className="au-check">
          <input
            id="su-terms"
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            required
            aria-invalid={!!termsErr}
            aria-describedby={termsErr ? "su-terms-err" : undefined}
          />
          <span>
            I agree to the{" "}
            <a href={ROUTES.terms} target="_blank" rel="noopener noreferrer">
              Terms<span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            and{" "}
            <a href={ROUTES.privacy} target="_blank" rel="noopener noreferrer">
              Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </span>
        </label>
        {termsErr && (
          <p className="au-err" id="su-terms-err">
            <Icon name="alert" size={14} />
            <span>{errors.terms}</span>
          </p>
        )}

        {botCheck && (
          <>
            <Turnstile ref={ts} onToken={setTsToken} action="signup" />
            {submitted && errors.bot && (
              <p className="au-err" role="alert">
                <Icon name="alert" size={14} />
                <span>{errors.bot}</span>
              </p>
            )}
          </>
        )}

        {formError && <FormError>{formError}</FormError>}

        <button type="submit" className="btn p lg au-submit" disabled={busy} aria-busy={busy} data-testid="signup-submit">
          {busy ? (claim ? "Saving…" : "Creating your organization…") : claim ? "Save my work" : "Create organization"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      <div className="au-alt">
        <p>
          Already have an account? <Link href={loginUrl(next)}>Log in</Link>
        </p>
        {claim && <p className="au-fine">Logging in to another account ends this free trial.</p>}
      </div>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <AuthShell intro="next" stepsOnMobile>
          <AuthLoading lines={4} />
        </AuthShell>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
