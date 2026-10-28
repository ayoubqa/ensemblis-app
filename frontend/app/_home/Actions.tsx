"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { StartLink } from "@/components/site/StartLink";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { ROUTES } from "@/lib/routes";
import { TrialModal } from "./TrialModal";

/**
 * The line under the hero's buttons — the one thing that depends on who is looking:
 *   signed in → back to the workspace · invite-only beta → how access works · trial on → try without an account
 *   otherwise → log in.
 * `/?trial=1` (linked from the login page) still opens the no-account trial when the deployment offers it.
 */
export function HeroNote() {
  const { user, loading } = useAuth();
  const { config, loaded } = useConfig();
  const [trial, setTrial] = useState(false);

  useEffect(() => {
    if (config.guestTrialEnabled && !user && new URLSearchParams(window.location.search).get("trial") === "1") setTrial(true);
  }, [config.guestTrialEnabled, user]);

  return (
    <>
      <p className="st-cta-note" aria-live="polite">
        {loading || !loaded ? (
          " "
        ) : user ? (
          <Link href={ROUTES.dashboard} className="st-textlink">
            Open your workspace <Icon name="chev" size={14} />
          </Link>
        ) : config.guestTrialEnabled ? (
          <button type="button" className="st-textlink st-linkbtn" onClick={() => setTrial(true)}>
            Or try it without an account <Icon name="chev" size={14} />
          </button>
        ) : config.inviteRequired ? (
          <>
            Private beta:{" "}
            <Link href={ROUTES.access} className="st-textlink">
              request access
            </Link>
            , or{" "}
            <Link href={ROUTES.signup} className="st-textlink">
              use your invite code
            </Link>
            .
          </>
        ) : (
          <>
            Already using Ensemblis?{" "}
            <Link href={ROUTES.login} className="st-textlink">
              Log in
            </Link>
          </>
        )}
      </p>
      <TrialModal open={trial} onClose={() => setTrial(false)} />
    </>
  );
}

export function FinalActions({ secondary = { href: "/how-it-works", label: "Explore Ensemblis" } }: { secondary?: { href: string; label: string } }) {
  return (
    <div className="mk-ctas mk-ctas-center">
      <StartLink from="final-actions">
        Get started
        <Icon name="arrow" />
      </StartLink>
      <Link href={secondary.href} className="btn lg mk-btn-quiet">
        {secondary.label}
      </Link>
    </div>
  );
}
