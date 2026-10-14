"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Icon } from "@/components";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorText } from "@/lib/errors";
import { ROUTES, loginUrl } from "@/lib/routes";
import { AuthLoading, AuthShell, AuthStatus } from "../login/_components/AuthUI";

type State = { kind: "working" } | { kind: "ok" } | { kind: "bad"; message: string; status?: number };

function Verify() {
  const params = useSearchParams();
  const token = (params.get("token") || "").trim();
  const router = useRouter();
  const { user, loading, setUser, signOut } = useAuth();
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
      .catch((e) =>
        setState({ kind: "bad", message: errorText(e, "This verification link is invalid or has expired."), status: e instanceof ApiError ? e.status : undefined })
      );
  }, [token, user, loading, router, setUser]);

  if (state.kind === "working") {
    return (
      <AuthStatus icon="mail" title="Verifying your email…" busy>
        <p>One moment.</p>
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
            {user ? "Open your workspace" : "Log in"}
            <Icon name="arrow" />
          </Link>
        }
      >
        <p>Thanks — your address is confirmed.</p>
      </AuthStatus>
    );
  }
  // 403: the link belongs to a different account than the one logged in here — a new link from
  // Settings wouldn't help; the way forward is to sign out and log in to that account.
  const otherAccount = state.status === 403 && !!user;
  const switchAccount = () => {
    signOut();
    router.push(loginUrl(`${ROUTES.verifyEmail}?token=${encodeURIComponent(token)}`));
  };
  return (
    <AuthStatus
      icon="clock"
      tone="warn"
      title="This link can't be used"
      actions={
        otherAccount ? (
          <button type="button" className="btn p" onClick={switchAccount}>
            Log in to the other account
          </button>
        ) : (
          <Link className="btn" href={!user ? ROUTES.login : `${ROUTES.settings}#profile`}>
            {!user ? "Log in" : "Send a new link from Settings"}
          </Link>
        )
      }
    >
      {/* The server's 403 text already says what to do; don't repeat it. */}
      <p>{otherAccount ? state.message : `${state.message} Verification links work once and expire after 48 hours.`}</p>
    </AuthStatus>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell>
      <Suspense fallback={<AuthLoading lines={1} />}>
        <Verify />
      </Suspense>
    </AuthShell>
  );
}
