"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { TrackedLink } from "@/components/site/TrackedLink";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { CONTACT_EMAIL, mailto } from "@/lib/contact";
import { ROUTES } from "@/lib/routes";

const TEMPLATE = `Hello,

I'd like early access to Ensemblis.

Name:
Company and website:
My role:
The first outcome I'd hand to Ensemblis:

Thanks!`;

/**
 * The address and the template as plain text, with copy buttons: a mailto link does nothing for the many
 * people whose email lives in a browser tab, so they must be able to write from wherever they read mail.
 */
function CopyRequest() {
  const [copied, setCopied] = useState<"" | "address" | "template">("");
  const copy = async (what: "address" | "template") => {
    try {
      await navigator.clipboard.writeText(what === "address" ? CONTACT_EMAIL : TEMPLATE);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      /* clipboard unavailable: the address is on screen to select by hand */
    }
  };
  return (
    <div className="st-access-copy">
      <p>
        Email app didn&apos;t open? Write to <b className="st-access-addr">{CONTACT_EMAIL}</b> from wherever you read your mail.
      </p>
      <div className="st-access-copy-btns" aria-live="polite">
        <button type="button" className="btn sm" onClick={() => copy("address")}>
          {copied === "address" ? "Address copied" : "Copy address"}
        </button>
        <button type="button" className="btn sm" onClick={() => copy("template")}>
          {copied === "template" ? "Template copied" : "Copy the template"}
        </button>
      </div>
    </div>
  );
}

/** The live part of /access: what to do next depends on whether sign-up needs an invite right now. */
export function AccessPanel() {
  const { user } = useAuth();
  const { config, loaded } = useConfig();
  const request = mailto("Ensemblis early access request", TEMPLATE);

  if (user) {
    return (
      <div className="st-access-card">
        <p className="st-lg-k">You&apos;re in</p>
        <h2>You already have access.</h2>
        <Link href={ROUTES.newObjective} className="btn p lg">
          Define an outcome <Icon name="arrow" />
        </Link>
      </div>
    );
  }

  if (loaded && !config.inviteRequired) {
    return (
      <div className="st-access-card">
        <p className="st-lg-k">Sign-up is open</p>
        <h2>No invite needed right now.</h2>
        <p>Create your organization and start with free beta credits.</p>
        <div className="st-ctas">
          <Link href={ROUTES.signup} className="btn p lg">
            Create your account <Icon name="arrow" />
          </Link>
          {config.guestTrialEnabled && (
            <Link href="/?trial=1" className="btn lg st-btn-quiet">
              Try without an account
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="st-access-card">
      <p className="st-lg-k">Private beta</p>
      <h2>Have an invite code?</h2>
      <p>Create your account with it — your code came with your invitation.</p>
      <Link href={ROUTES.signup} className="btn lg st-btn-quiet">
        Sign up with an invite code
      </Link>
      <hr />
      <h2>No code yet? Request access.</h2>
      {request ? (
        <>
          <p>Send a short note with your company and the first outcome you&apos;d hand over — it opens in your email app with a template to fill in.</p>
          <TrackedLink href={request} event="access_request_click" props={{ from: "access-page" }} className="btn p lg">
            Request access by email <Icon name="mail" />
          </TrackedLink>
          <CopyRequest />
          <p className="st-access-next">Invites are sent by email, with a code to create your account.</p>
        </>
      ) : (
        <p className="st-access-missing">
          Online requests aren&apos;t open yet. If someone at Ensemblis invited you to try it, ask them for a code.
        </p>
      )}
    </div>
  );
}
