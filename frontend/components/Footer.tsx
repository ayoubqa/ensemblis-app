"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { ROUTES } from "@/lib/routes";
import { Icon } from "./Icon";
import { Lockup } from "./Logo";

type Col = { title: string; links: [string, string][] };

/** Site footer: brand lockup, one "Footer" navigation with three columns, legal line. Rendered once by the root layout. */
export function Footer() {
  const { user } = useAuth();
  const isGuest = !!user?.isGuest;
  const year = new Date().getFullYear();

  const cols: Col[] = user
    ? [
        {
          title: "Workspace",
          links: [
            ["Home", ROUTES.dashboard],
            ["Objectives", ROUTES.objectives],
            ["AI Team", ROUTES.aiTeam],
            ["Company Context", ROUTES.context],
            ["Reports", ROUTES.reports],
          ],
        },
        {
          title: "Control",
          links: [
            ["Approvals", ROUTES.approvals],
            ["Exceptions", ROUTES.exceptions],
            ["Usage", ROUTES.usage],
            ["Recurring objectives", ROUTES.routines],
            ...(isGuest ? [] : ([["Settings", ROUTES.settings]] as [string, string][])),
          ],
        },
        {
          title: "About",
          links: [
            ["How it works", ROUTES.howItWorksPage],
            ["Privacy Policy", ROUTES.privacy],
            ["Terms of Use", ROUTES.terms],
          ],
        },
      ]
    : [
        {
          title: "Product",
          links: [
            ["How it works", ROUTES.howItWorksPage],
            ["Control & trust", ROUTES.trust],
          ],
        },
        {
          title: "Account",
          links: [
            ["Get started", ROUTES.signup],
            ["Log in", ROUTES.login],
          ],
        },
        {
          title: "Legal",
          links: [
            ["Privacy Policy", ROUTES.privacy],
            ["Terms of Use", ROUTES.terms],
          ],
        },
      ];

  return (
    <footer className="ft sh-ft no-print">
      <div className="wrap">
        <div className="sh-ft-grid">
          <div className="sh-ft-brand">
            <Link href={user ? ROUTES.dashboard : ROUTES.home} aria-label="Ensemblis home">
              <Lockup size={26} />
            </Link>
            <p className="sh-ft-tag">
              <b>The AI operating layer for business.</b>
              Describe the outcome. We do the work.
            </p>
          </div>
          <nav aria-label="Footer" className="sh-ft-cols">
            {cols.map((c) => (
              <div key={c.title}>
                <h2 className="sh-ft-h">{c.title}</h2>
                <ul>
                  {c.links.map(([label, href]) => (
                    <li key={label}>
                      <Link href={href}>{label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="sh-ft-base">
          <p>© {year} Ensemblis</p>
          <p className="sh-ft-note">
            <Icon name="shield" />
            AI-generated work can contain mistakes — review the evidence and verification before acting.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
