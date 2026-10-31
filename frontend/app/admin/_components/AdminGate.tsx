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
 * deployment answered and what is wrong with THIS account's entry. The operator list itself is never shown.
 * Remove with the endpoint.
 */
const ISSUE_TEXT: Record<NonNullable<OperatorCheck["adminEmails"]["yourEntry"]>["issues"][number], string> = {
  quotes: "wrapped in quotes",
  invisible_characters: "contains invisible characters",
  look_alike_characters: "uses look-alike (non-Latin) letters",
  pasted_prefix: "starts with a pasted ADMIN_EMAILS= or mailto:",
  angle_brackets: "wrapped in < >",
  wrong_separator: "separated with ; or a space instead of a comma",
};

function yourEntryText(a: OperatorCheck["adminEmails"]): string {
  if (a.yourEntry) {
    if (!a.yourEntry.issues.length) return "present, exactly your address";
    const chars = a.yourEntry.unusualCharacters.length ? ` (${a.yourEntry.unusualCharacters.join(" ")})` : "";
    return `present but ${a.yourEntry.issues.map((i) => ISSUE_TEXT[i]).join(", ")}${chars}`;
  }
  if (a.closeMatch) return "not found; one entry is a near-miss of your address (a typo?)";
  return "nothing resembling your address";
}

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
    ["ADMIN_EMAILS defined", a.adminEmailsDefined ? (a.hasEntries ? "yes" : "yes, but empty") : "no"],
    ["Your entry", yourEntryText(a)],
    ["Your email matches (live rule)", a.yourEmailMatches ? "yes" : "no"],
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
