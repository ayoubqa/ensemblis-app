"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { ROUTES } from "@/lib/routes";
import { TrialModal } from "./TrialModal";

/**
 * The landing page's calls to action. The primary label is the same signed in
 * or out (only its destination changes), so nothing shifts when auth resolves.
 * `/?trial=1` (linked from the login page) opens the no-account trial.
 */
export function HeroActions() {
  const { user, loading } = useAuth();
  const { config } = useConfig();
  const [trial, setTrial] = useState(false);

  useEffect(() => {
    if (config.guestTrialEnabled && !user && new URLSearchParams(window.location.search).get("trial") === "1") setTrial(true);
  }, [config.guestTrialEnabled, user]);

  return (
    <>
      <div className="mk-ctas">
        <Link href={user ? ROUTES.newObjective : ROUTES.signup} className="btn p lg">
          Define an outcome
          <Icon name="arrow" />
        </Link>
        <a href="#how" className="btn lg mk-btn-quiet">
          See how it works
        </a>
      </div>
      <p className="mk-cta-note" aria-live="polite">
        {loading ? (
          " "
        ) : user ? (
          <Link href={ROUTES.dashboard} className="mk-textlink">
            Open your workspace <Icon name="chev" size={14} />
          </Link>
        ) : config.guestTrialEnabled ? (
          <button type="button" className="mk-textlink" onClick={() => setTrial(true)}>
            Or try it without an account <Icon name="chev" size={14} />
          </button>
        ) : (
          <Link href={ROUTES.login} className="mk-textlink">
            Already using Ensemblis? Log in <Icon name="chev" size={14} />
          </Link>
        )}
      </p>
      <TrialModal open={trial} onClose={() => setTrial(false)} />
    </>
  );
}

export function FinalActions({ secondary = { href: "/how-it-works", label: "Explore Ensemblis" } }: { secondary?: { href: string; label: string } }) {
  const { user } = useAuth();
  return (
    <div className="mk-ctas mk-ctas-center">
      <Link href={user ? ROUTES.newObjective : ROUTES.signup} className="btn p lg">
        Define an outcome
        <Icon name="arrow" />
      </Link>
      <Link href={secondary.href} className="btn lg mk-btn-quiet">
        {secondary.label}
      </Link>
    </div>
  );
}
