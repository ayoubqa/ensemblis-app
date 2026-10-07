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
    ["wallet", "One organization wallet", "Executions are paid from the owner's balance. Members never need their own."],
    ["list", "Shared objectives & context", "Everyone works from the same Company Context, memory, objectives and AI Team."],
    ["lock", "Owner stays in control", "The owner sets the approval policy, invites with expiring links and can remove people any time."],
  ];
  return (
    <div className="grid g3" style={{ gap: 10, margin: compact ? "12px 0" : "20px 0" }}>
      {items.map(([ic, t, d]) => (
        <div key={t} className="mini">
          <span style={{ color: "var(--accent)" }}>
            <Icon name={ic} />
          </span>
          <b style={{ display: "block", marginTop: 6 }}>{t}</b>
          <div className="tiny muted">{d}</div>
        </div>
      ))}
    </div>
  );
}

export function SectionHead({ id, title, sub, right }: { id: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="row between wrapflex" style={{ gap: 10, margin: "28px 0 10px" }}>
      <div>
        <h3 id={id} style={{ margin: 0 }}>
          {title}
        </h3>
        {sub && (
          <p className="small muted" style={{ margin: "2px 0 0" }}>
            {sub}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}
