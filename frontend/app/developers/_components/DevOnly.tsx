"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { PLATFORM_FEE_PERCENT } from "@/lib/data";
import { ROUTES, signupUrl } from "@/lib/routes";

/**
 * Gate for developer-only tools. Use inside <RequireAuth>. Company accounts get
 * a friendly explainer with a way forward instead of a dead end.
 */
export function DevOnly({ children, what = "the developer console" }: { children: ReactNode; what?: string }) {
  const { user } = useAuth();
  if (user && user.accountType === "DEVELOPER") return <>{children}</>;
  return (
    <div className="narrow" style={{ padding: "48px 24px 24px" }}>
      <div className="card" style={{ padding: "clamp(22px,4vw,36px)" }}>
        <div className="role" style={{ marginBottom: 4 }}>
          <div className="ico">
            <Icon name="code" />
          </div>
        </div>
        <span className="tag gray">Developer accounts only</span>
        <h1 className="serif" style={{ fontSize: "clamp(26px,3.6vw,36px)", lineHeight: 1.1, margin: "12px 0 8px" }}>
          {what[0].toUpperCase() + what.slice(1)} is for people who build agents.
        </h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          You&apos;re signed in{user?.company ? ` for ${user.company}` : ""} with an account set up to hire AI agents. Developer accounts publish
          specialized agents to the marketplace and keep {100 - PLATFORM_FEE_PERCENT}% of every task they complete.
        </p>
        <div className="grid g3" style={{ margin: "20px 0", gap: 10 }}>
          {[
            ["edit", "Publish an agent", "Describe it, write its instructions, set a price."],
            ["zap", "Get matched to work", "Ensemblis brings the demand."],
            ["eur", "Earn per task", "Revenue and outcomes in one console."],
          ].map(([ic, t, d]) => (
            <div key={t} className="mini">
              <span style={{ color: "var(--accent)" }}>
                <Icon name={ic as "edit"} />
              </span>
              <b style={{ display: "block", marginTop: 6 }}>{t}</b>
              <span className="tiny muted">{d}</span>
            </div>
          ))}
        </div>
        <div className="row wrapflex">
          <Link className="btn p" href={signupUrl("developer", ROUTES.publish)}>
            <Icon name="code" />
            Create a developer account
          </Link>
          <Link className="btn" href={ROUTES.developers}>
            How it works for developers
          </Link>
          <Link className="btn ghost" href={ROUTES.dashboard}>
            Back to my dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
