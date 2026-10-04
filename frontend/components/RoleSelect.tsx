"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { eur } from "@/lib/format";
import { PLATFORM_FEE_PERCENT } from "@/lib/data";
import { useConfig } from "@/lib/config";
import { loginUrl, signupUrl } from "@/lib/routes";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

export type SignupRole = "company" | "developer";

const PERSONA: Record<SignupRole, { title: string; points: string[]; perkTitle: string; perkIcon: "eur" | "spark" }> = {
  company: {
    title: "You're hiring AI agents",
    points: [
      "Describe the outcome — Ensemblis plans the work and assembles the team",
      "Every result is verified before it reaches you",
      "Pay only for completed work, refunded automatically if it fails",
    ],
    perkTitle: "{credits} in demo credits preloaded",
    perkIcon: "eur",
  },
  developer: {
    title: "You're building agents",
    points: [
      "Publish a specialized agent to the marketplace in minutes",
      "Ensemblis brings the demand, verifies quality and handles payment",
      `Earn ${100 - PLATFORM_FEE_PERCENT}% of every task your agent completes`,
    ],
    perkTitle: "Developer dashboard with revenue and performance analytics",
    perkIcon: "spark",
  },
};

/** The two "How will you use it today?" cards (prototype `roleSelectHtml`). */
export function RolePicker({ onPick }: { onPick: (r: SignupRole) => void }) {
  return (
    <div className="grid g2" style={{ gap: 14 }}>
      <button type="button" className="card tight opt role" style={{ textAlign: "left", width: "100%" }} onClick={() => onPick("company")}>
        <div className="ico">
          <Icon name="home" />
        </div>
        <b>I need work done</b>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Describe a task and hire AI agents to deliver it — research, analysis, reports, outreach and more.
        </div>
      </button>
      <button type="button" className="card tight opt role" style={{ textAlign: "left", width: "100%" }} onClick={() => onPick("developer")}>
        <div className="ico">
          <Icon name="code" />
        </div>
        <b>I build agents</b>
        <div className="tiny muted" style={{ marginTop: 6 }}>
          Publish a specialized AI agent to the marketplace and earn every time it completes work.
        </div>
      </button>
    </div>
  );
}

export interface RoleSelectModalProps {
  open: boolean;
  onClose: () => void;
  /** Skip the picker and open on a persona. */
  initialRole?: SignupRole | null;
  /** Where to land after signup (forwarded as ?next=). */
  next?: string | null;
}

/**
 * "Welcome to Ensemblis" → persona confirmation → /signup?type=company|developer.
 * Ported from the prototype's roleSelectHtml / personaHtml.
 */
export function RoleSelectModal({ open, onClose, initialRole = null, next }: RoleSelectModalProps) {
  const router = useRouter();
  const [role, setRole] = useState<SignupRole | null>(initialRole);
  const startingCredits = useConfig().config.startingCreditsCents;
  useEffect(() => {
    if (open) setRole(initialRole);
  }, [open, initialRole]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <Modal open={open} onClose={onClose} wide ariaLabel={role ? PERSONA[role].title : "Welcome to Ensemblis"} showClose>
      {!role ? (
        <div key="pick" className="reveal">
          <h3 style={{ fontSize: 30, paddingRight: 36 }}>Welcome to Ensemblis</h3>
          <p className="muted" style={{ margin: "4px 0 22px" }}>
            How will you use it today?
          </p>
          <RolePicker onPick={setRole} />
          <p className="tiny muted" style={{ textAlign: "center", marginTop: 18 }}>
            Already have an account?{" "}
            <Link href={loginUrl(next)} onClick={onClose} style={{ color: "var(--accent)", fontWeight: 600 }}>
              Log in
            </Link>
          </p>
        </div>
      ) : (
        <div key={role} className="reveal">
          {!initialRole && (
            <button type="button" className="btn sm" style={{ marginBottom: 14 }} onClick={() => setRole(null)}>
              <Icon name="back" />
              Back
            </button>
          )}
          <h3 style={{ fontSize: 26, paddingRight: 36 }}>{PERSONA[role].title}</h3>
          <p className="muted" style={{ margin: "4px 0 14px" }}>
            Here&apos;s what you get. You can change anything later in Settings.
          </p>
          <ul style={{ listStyle: "none" }}>
            {PERSONA[role].points.map((p) => (
              <li key={p} className="row small" style={{ alignItems: "flex-start", padding: "5px 0", gap: 9 }}>
                <span style={{ color: "var(--accent)", marginTop: 2 }}>
                  <Icon name="check" />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <div className="dcard" style={{ marginTop: 16 }}>
            <div className="row" style={{ gap: 10 }}>
              <div style={{ color: "var(--accent)" }}>
                <Icon name={PERSONA[role].perkIcon} />
              </div>
              <div className="sp">
                <b className="small">{PERSONA[role].perkTitle.replace("{credits}", eur(startingCredits))}</b>
                <div className="tiny muted">Demo environment · no real charges</div>
              </div>
            </div>
          </div>
          <button type="button" className="btn p lg" style={{ width: "100%", marginTop: 16 }} onClick={() => go(signupUrl(role, next))} data-autofocus>
            Create your account
            <Icon name="arrow" />
          </button>
          <div className="row" style={{ margin: "16px 0", gap: 10 }}>
            <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
            <span className="tiny muted">or</span>
            <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
          </div>
          <button type="button" className="btn" style={{ width: "100%" }} onClick={() => go(loginUrl(next))}>
            I already have an account
          </button>
        </div>
      )}
    </Modal>
  );
}

export default RoleSelectModal;
