"use client";

import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";
import { Icon } from "@/components";
import { CONTACT_EMAIL, useConfig } from "@/lib/config";
import { ROUTES } from "@/lib/routes";

/** One date, two forms: shown to people, and machine-readable on <time>. */
export const LEGAL_UPDATED = "4 October 2026";
const LEGAL_UPDATED_ISO = "2026-10-04";

/** Operator contact: NEXT_PUBLIC_CONTACT_EMAIL, or a deliberately loud placeholder until it's configured. */
export function Contact() {
  if (CONTACT_EMAIL) return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
  return (
    <b className="au-missing">
      <Icon name="alert" />
      the operator&apos;s contact address (set NEXT_PUBLIC_CONTACT_EMAIL)
    </b>
  );
}

/** The AI provider label from /api/config (e.g. "OpenAI (gpt-4o-mini)"). */
export function AiProvider() {
  const { config } = useConfig();
  return <b>{config.aiProviderLabel}</b>;
}

export type LegalSection = { id: string; title: string };

/** The page's section list, so each <Sec> can number itself and the contents can link to it. */
const SectionsCtx = createContext<LegalSection[]>([]);

export function LegalPage({
  title,
  intro,
  summary,
  sections,
  other,
  children,
}: {
  title: string;
  intro: ReactNode;
  summary: ReactNode[];
  /** In reading order; ids are the public anchors (#about, #credits…) and must not change. */
  sections: LegalSection[];
  other: "privacy" | "terms";
  children: ReactNode;
}) {
  const otherDoc = other === "privacy" ? { href: ROUTES.privacy, label: "Privacy Policy" } : { href: ROUTES.terms, label: "Terms of Use" };
  return (
    <div className="au-legal">
      <div className="au-legal-in">
        <header className="au-legal-head">
          <p className="eyebrow">Legal</p>
          <h1>{title}</h1>
          <p className="au-legal-intro">{intro}</p>
          <div className="au-legal-meta">
            <span>
              <Icon name="clock" size={14} />
              Last updated <time dateTime={LEGAL_UPDATED_ISO}>{LEGAL_UPDATED}</time>
            </span>
            <span>
              <Icon name="file" size={14} />
              <Link href={otherDoc.href}>{otherDoc.label}</Link>
            </span>
          </div>
        </header>

        <div className="au-legal-grid">
          <nav className="au-toc" aria-label="Contents">
            <ol>
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>
                    <span aria-hidden="true">{i + 1}</span>
                    <span>{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="au-legal-body">
            <section className="au-short" aria-labelledby="in-short">
              <h2 id="in-short">
                <Icon name="info" size={16} />
                In short
              </h2>
              <ul className="au-points">
                {summary.map((s, i) => (
                  <li key={i}>
                    <Icon name="check" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </section>

            <SectionsCtx.Provider value={sections}>{children}</SectionsCtx.Provider>

            <p className="au-legal-foot">
              <Icon name="mail" size={16} />
              <span>
                See also our <Link href={otherDoc.href}>{otherDoc.label}</Link>. Questions? Write to <Contact />.
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A numbered section; its heading comes from the page's `sections` list. */
export function Sec({ id, children }: { id: string; children: ReactNode }) {
  const sections = useContext(SectionsCtx);
  const i = sections.findIndex((s) => s.id === id);
  const title = i >= 0 ? `${i + 1}. ${sections[i].title}` : id;
  return (
    <section className="rsec" id={id} aria-labelledby={`h-${id}`}>
      <h2 id={`h-${id}`}>{title}</h2>
      {children}
    </section>
  );
}
