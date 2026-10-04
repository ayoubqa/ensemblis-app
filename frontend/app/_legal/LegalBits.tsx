"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components";
import { CONTACT_EMAIL, useConfig } from "@/lib/config";
import { ROUTES } from "@/lib/routes";

export const LEGAL_UPDATED = "4 October 2026";

/** Operator contact: NEXT_PUBLIC_CONTACT_EMAIL, or a deliberately loud placeholder until it's configured. */
export function Contact() {
  if (CONTACT_EMAIL)
    return (
      <a href={`mailto:${CONTACT_EMAIL}`} style={{ wordBreak: "break-all" }}>
        {CONTACT_EMAIL}
      </a>
    );
  return <b style={{ color: "var(--bad)" }}>the operator&apos;s contact address (set NEXT_PUBLIC_CONTACT_EMAIL)</b>;
}

/** The AI provider name from /api/config, e.g. "Groq (Llama 3.3 70B)". */
export function AiProvider() {
  const { config } = useConfig();
  return <b>{config.aiProviderLabel}</b>;
}

export function LegalPage({
  title,
  intro,
  summary,
  other,
  children,
}: {
  title: string;
  intro: ReactNode;
  summary: ReactNode[];
  other: "privacy" | "terms";
  children: ReactNode;
}) {
  return (
    <div className="narrow legal" style={{ paddingBottom: 48 }}>
      <div className="pagehead">
        <div className="eyebrow">Legal</div>
        <h1>{title}</h1>
        <p>{intro}</p>
        <p className="small muted" style={{ marginTop: 8 }}>
          Last updated: <time dateTime="2026-10-04">{LEGAL_UPDATED}</time>
        </p>
      </div>

      <section className="card" aria-labelledby="in-short" style={{ marginBottom: 8 }}>
        <h2 id="in-short" className="row" style={{ gap: 8, fontSize: 16, margin: "0 0 6px" }}>
          <Icon name="info" size={16} style={{ color: "var(--accent)" }} />
          In short
        </h2>
        <ul style={{ margin: 0 }}>
          {summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </section>

      {children}

      <p className="small muted" style={{ marginTop: 10 }}>
        See also our{" "}
        {other === "privacy" ? <Link href={ROUTES.privacy}>Privacy Policy</Link> : <Link href={ROUTES.terms}>Terms of Use</Link>}. Questions? Write to <Contact />.
      </p>
    </div>
  );
}

export function Sec({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="rsec" id={id} aria-labelledby={`h-${id}`}>
      <h2 id={`h-${id}`}>{title}</h2>
      {children}
    </section>
  );
}
