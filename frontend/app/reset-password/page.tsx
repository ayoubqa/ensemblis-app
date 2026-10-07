"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Icon, useToast } from "@/components";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorText } from "@/lib/errors";
import { firstName } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { AuthShell, AuthStatus, Field, FormError, PasswordInput, StrengthMeter } from "../login/_components/AuthUI";

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
      <p style={{ margin: 0 }}>
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

  useEffect(() => {
    document.getElementById("rp-password")?.focus();
  }, []);

  if (!token || token.length < 10) return <InvalidLink incomplete />;
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
      setError(errorText(err, "Couldn't update your password. Please try again."));
    }
  };

  return (
    <>
      <span
        aria-hidden="true"
        style={{ display: "grid", placeItems: "center", width: 48, height: 48, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", marginBottom: 16 }}
      >
        <Icon name="lock" size={22} />
      </span>
      <h1 className="serif" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1.1 }}>
        Choose a new password
      </h1>
      <p className="muted" style={{ margin: "4px 0 6px" }}>
        Pick something you don&apos;t use anywhere else. You&apos;ll be signed in right after.
      </p>
      <form onSubmit={submit} noValidate>
        <Field id="rp-password" label="New password" error={showPw ? pwErr : null}>
          <PasswordInput
            id="rp-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => password && setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={showPw}
            aria-describedby={showPw ? "rp-password-err" : undefined}
            minLength={8}
          />
          {!showPw && <StrengthMeter pw={password} />}
        </Field>
        <Field id="rp-confirm" label="Confirm new password" error={showConfirm ? confirmErr : null}>
          <PasswordInput
            id="rp-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => confirm && setTouched((t) => ({ ...t, confirm: true }))}
            aria-invalid={showConfirm}
            aria-describedby={showConfirm ? "rp-confirm-err" : undefined}
          />
          {!showConfirm && confirm.length > 0 && confirm === password && (
            <div className="hint row" style={{ gap: 6, color: "var(--ok)" }}>
              <Icon name="check" size={13} />
              Passwords match
            </div>
          )}
        </Field>
        {error && <FormError>{error}</FormError>}
        <button type="submit" className="btn p lg" style={{ width: "100%", marginTop: 20 }} disabled={busy} aria-busy={busy}>
          {busy ? "Saving…" : "Save new password"}
          {!busy && <Icon name="arrow" />}
        </button>
      </form>
      <p className="small muted" style={{ textAlign: "center", marginTop: 20 }}>
        Link not working?{" "}
        <Link href={ROUTES.forgotPassword} style={{ color: "var(--accent)", fontWeight: 600 }}>
          Request a new one
        </Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={<div className="sk" style={{ height: 260 }} aria-busy="true" />}>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
