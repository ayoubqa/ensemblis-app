"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type FormEvent } from "react";
import { Icon, useToast } from "@/components";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { firstName } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { AuthHead, AuthLoading, AuthShell, AuthStatus, Field, FormError, PasswordInput, StrengthMeter, authErrorText, useAutoFocus } from "../login/_components/AuthUI";

function InvalidLink({ incomplete }: { incomplete?: boolean }) {
  return (
    <AuthStatus
      icon="clock"
      tone="warn"
      title={incomplete ? "This reset link is incomplete" : "This reset link has expired"}
      actions={
        <>
          <Link className="btn p" href={ROUTES.forgotPassword}>
            Request a new link
            <Icon name="arrow" />
          </Link>
          <Link className="btn" href={ROUTES.login}>
            Back to log in
          </Link>
        </>
      }
    >
      <p>
        {incomplete
          ? "The link is missing part of its code — it may have been cut off when it was copied. Open it straight from the email, or request a new one."
          : "Reset links work once and expire after an hour, so this one can't be used any more. Request a new link and use the newest email."}
      </p>
    </AuthStatus>
  );
}

function ResetForm() {
  const params = useSearchParams();
  const token = (params.get("token") || "").trim();
  const router = useRouter();
  const toast = useToast();
  const { signIn } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState({ password: false, confirm: false });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const valid = !!token && token.length >= 10;

  useAutoFocus(pwRef, valid && !expired);

  if (!valid) return <InvalidLink incomplete />;
  if (expired) return <InvalidLink />;

  const pwErr = password.length < 8 ? (password ? "Use at least 8 characters" : "Choose a new password") : null;
  const confirmErr = !confirm ? "Type the new password again" : confirm !== password ? "The passwords don't match" : null;
  // Don't nag while the first field is still being typed; do once it's been left (or on submit).
  const showPw = (submitted || (touched.password && password.length > 0)) && !!pwErr;
  const showConfirm = (submitted || touched.confirm) && !!confirmErr;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (pwErr) return document.getElementById("rp-password")?.focus();
    if (confirmErr) return document.getElementById("rp-confirm")?.focus();
    setBusy(true);
    try {
      const { token: session, user } = await api.resetPassword({ token, password });
      signIn(session, user);
      toast(`Password updated — welcome back, ${firstName(user.name)}`, { icon: "lock" });
      router.replace(ROUTES.dashboard);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 400 && /invalid|expired/i.test(err.message)) {
        setExpired(true);
        return;
      }
      setError(authErrorText(err, "Couldn't update your password. Please try again."));
    }
  };

  const match = !showConfirm && confirm.length > 0 && confirm === password;
  const pwDesc = showPw ? "rp-password-err" : password ? "rp-password-strength" : "rp-password-hint";
  const confirmDesc = showConfirm ? "rp-confirm-err" : match ? "rp-confirm-match" : undefined;

  return (
    <>
      <AuthHead icon="lock" title="Choose a new password">
        Pick something you don&apos;t use anywhere else. You&apos;ll be logged in right after.
      </AuthHead>
      <form onSubmit={submit} noValidate>
        <Field id="rp-password" label="New password" error={showPw ? pwErr : null} hint={!password ? "At least 8 characters." : undefined}>
          <PasswordInput
            ref={pwRef}
            id="rp-password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => password && setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={showPw}
            aria-describedby={pwDesc}
            minLength={8}
          />
          {!showPw && <StrengthMeter pw={password} id="rp-password-strength" />}
        </Field>
        <Field id="rp-confirm" label="Confirm new password" error={showConfirm ? confirmErr : null}>
          <PasswordInput
            id="rp-confirm"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => confirm && setTouched((t) => ({ ...t, confirm: true }))}
            aria-invalid={showConfirm}
            aria-describedby={confirmDesc}
          />
          {match && (
            <p className="au-hint ok" id="rp-confirm-match">
              <Icon name="check" size={14} />
              Passwords match
            </p>
          )}
        </Field>
        {error && <FormError>{error}</FormError>}
        <button type="submit" className="btn p lg au-submit" disabled={busy} aria-busy={busy}>
          {busy ? "Saving…" : "Save new password"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      <div className="au-alt">
        <p>
          Link not working? <Link href={ROUTES.forgotPassword}>Request a new one</Link>
        </p>
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={<AuthLoading lines={2} />}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
