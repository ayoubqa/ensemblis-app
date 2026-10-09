"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components";

export const TEAM_NAME_MIN = 2;
export const TEAM_NAME_MAX = 60;

export function teamNameError(name: string): string | null {
  const n = name.trim();
  if (n.length < TEAM_NAME_MIN) return `Use at least ${TEAM_NAME_MIN} characters.`;
  if (n.length > TEAM_NAME_MAX) return `Keep it under ${TEAM_NAME_MAX} characters.`;
  return null;
}

/** Copy text; falls back to a hidden textarea when the async clipboard is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function inviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/join/${encodeURIComponent(token)}`;
}

/** Explainer tiles: what organization membership means. */
export function TeamExplainer({ compact }: { compact?: boolean }) {
  const items: [IconName, string, string][] = [
    ["wallet", "One organization balance", "Executions are paid from the owner's balance. Members never need their own."],
    ["list", "Shared objectives & context", "Everyone works from the same Company Context, Memory, objectives and AI Team."],
    ["lock", "The owner stays in control", "The owner sets the approval policy, invites with expiring links and can remove people at any time."],
  ];
  return (
    <ul className={compact ? "op-explain compact" : "op-explain"}>
      {items.map(([ic, t, d]) => (
        <li key={t}>
          <Icon name={ic} />
          <b>{t}</b>
          <p>{d}</p>
        </li>
      ))}
    </ul>
  );
}

/** Section heading (h2) with an optional description and a right-hand action. */
export function SectionHead({ id, title, sub, right }: { id: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="op-sec-head" style={{ marginTop: 40 }}>
      <div>
        <h2 id={id}>{title}</h2>
        {sub && <p className="op-sec-sub">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
