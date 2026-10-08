"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Icon } from "@/components";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorText } from "@/lib/errors";
import { ROUTES, loginUrl } from "@/lib/routes";
import { AuthShell, AuthStatus } from "../login/_components/AuthUI";

type State = { kind: "working" } | { kind: "ok" } | { kind: "bad"; message: string };

function Verify() {
  const params = useSearchParams();
  const token = (params.get("token") || "").trim();
  const router = useRouter();
  const { user, loading, setUser } = useAuth();
  const [state, setState] = useState<State>(token ? { kind: "working" } : { kind: "bad", message: "This link is missing its code. Open it straight from the email." });
  const sent = useRef(false);

  useEffect(() => {
    // Tokens are single-use: never submit twice (React strict mode runs effects twice in development).
    if (!token || sent.current || loading) return;
    // The link only verifies the account it was sent to, so it needs that account's session.
    if (!user) {
      router.replace(loginUrl(`${ROUTES.verifyEmail}?token=${encodeURIComponent(token)}`));
      return;
    }
    sent.current = true;
    api
      .verifyEmail(token)
      .then(({ user: u }) => {
        setState({ kind: "ok" });
        setUser((cur) => (cur && cur.id === u.id ? u : cur));
      })
      .catch((e) => setState({ kind: "bad", message: errorText(e, "This verification link is invalid or has expired.") }));
  }, [token, user, loading, router, setUser]);

  if (state.kind === "working") {
    return (
      <AuthStatus icon="mail" title="Verifying your email…">
        <p style={{ margin: 0 }}>One moment.</p>
      </AuthStatus>
    );
  }
  if (state.kind === "ok") {
    return (
      <AuthStatus
        icon="check"
        tone="ok"
        title="Your email is verified"
        actions={
          <Link className="btn p" href={user ? ROUTES.dashboard : ROUTES.login}>
            {user ? "Open your briefing" : "Log in"}
            <Icon name="arrow" />
          </Link>
        }
      >
        <p style={{ margin: 0 }}>Thanks — your address is confirmed.</p>
      </AuthStatus>
    );
  }
  return (
    <AuthStatus
      icon="clock"
      tone="warn"
      title="This link can't be used"
      actions={
        <Link className="btn" href={user ? `${ROUTES.settings}#profile` : ROUTES.login}>
          {user ? "Send a new link from Settings" : "Log in"}
        </Link>
      }
    >
      <p style={{ margin: 0 }}>{state.message} Verification links work once and expire after 48 hours.</p>
    </AuthStatus>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell>
      <Suspense fallback={<div className="sk" style={{ height: 160 }} />}>
        <Verify />
      </Suspense>
    </AuthShell>
  );
}
