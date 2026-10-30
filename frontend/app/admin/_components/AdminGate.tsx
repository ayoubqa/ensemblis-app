"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type OperatorCheck } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { Icon, PageSkeleton } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { ROUTES } from "@/lib/routes";
import { OwnerDashboard } from "./OwnerDashboard";

/**
 * /admin: deployment operators only — a verified email listed in the server's
 * ADMIN_EMAILS (user.isAdmin). Everyone else sees a plain "not available".
 * The server enforces the same rule on /api/admin/*.
 */
export function AdminGate() {
  const { user, loading } = useAuth();
  if (loading) return <PageSkeleton cards={4} />;
  if (!user?.isAdmin)
    return (
      <div className="wrap op-page">
        <div className="op-panel op-gate">
          <span className="op-ico" aria-hidden="true">
            <Icon name="lock" />
          </span>
          <h1>Operations console</h1>
          <p>This page is for the people who operate this Ensemblis deployment.</p>
          {/* Which requirement the signed-in account misses — only ever about this account, never the operator list. */}
          {!user ? (
            <p>
              <Link href={ROUTES.login}>Sign in</Link> with an operator account.
            </p>
          ) : user.isGuest ? (
            <p>Guest trial accounts can&apos;t open it.</p>
          ) : !user.emailVerified ? (
            <p>
              You&apos;re signed in as <b>{user.email}</b>, which isn&apos;t verified yet. Operators must have a verified email —{" "}
              <Link href={`${ROUTES.settings}#profile`}>verify yours in Settings</Link>.
            </p>
          ) : (
            <>
              <p>
                You&apos;re signed in as <b>{user.email}</b> (verified), and this address isn&apos;t one of this deployment&apos;s operators.{" "}
                <Link href={ROUTES.dashboard}>Back to Home</Link>
              </p>
              <OperatorDiagnostics />
            </>
          )}
        </div>
      </div>
    );
  return <OwnerDashboard />;
}

/**
 * TEMPORARY: what the API itself sees for this account (GET /api/auth/operator-check) — whether the expected
 * deployment answered and the masked shape of its operator list. Remove with the endpoint.
 */
function OperatorDiagnostics() {
  const [check, setCheck] = useState<OperatorCheck | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api.operatorCheck().then(setCheck, setError);
  }, []);
  if (error) return <p className="tiny muted">Diagnostics unavailable: {errorText(error, "the server didn't answer")}</p>;
  if (!check) return <p className="tiny muted">Checking what the server sees…</p>;
  const { deployment: d, adminEmails: a } = check;
  const rows: [string, string][] = [
    ["Expected API service", d.expectedService === null ? "not reported" : d.expectedService ? "yes" : "no"],
    ["Release", d.release ?? "not reported"],
    ["Started", d.startedAt],
    ["ADMIN_EMAILS defined", a.adminEmailsDefined ? "yes" : "no"],
    ["Entries", String(a.entryCount)],
    ...a.entries.map((e, i): [string, string] => [
      `Entry ${i + 1}`,
      [e.masked, e.looksLikeEmail ? "plain address" : "not a plain address", e.hasQuotes ? "has quotes" : "", e.unusualCharacters.length ? `unusual: ${e.unusualCharacters.join(" ")}` : ""].filter(Boolean).join(" · "),
    ]),
    ["Your email matches", a.yourEmailMatches ? "yes" : "no"],
    ["Would match without quotes/invisible characters", a.yourEmailMatchesAfterCleanup ? "yes" : "no"],
    ["Changed since the server started", a.differsFromBootValue ? "yes" : "no"],
    ["Misspelt ADMIN_EMAILS names", a.nearMissKeys.length ? a.nearMissKeys.join(", ") : "none"],
  ];
  return (
    <dl className="tiny" data-testid="operator-diagnostics" style={{ textAlign: "left", marginTop: 12 }}>
      {rows.map(([k, v]) => (
        <div key={k} className="row" style={{ gap: 8 }}>
          <dt className="muted">{k}</dt>
          <dd style={{ margin: 0, wordBreak: "break-all" }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
