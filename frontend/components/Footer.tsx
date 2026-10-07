"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { ROUTES } from "@/lib/routes";
import { Mark } from "./Logo";

/** Site footer. Rendered once by the root layout. */
export function Footer() {
  const { user } = useAuth();
  const cols: { title: string; links: [string, string][] }[] = [
    {
      title: "Product",
      links: user
        ? [
            ["Dashboard", ROUTES.dashboard],
            ["Objectives", ROUTES.objectives],
            ["AI Team", ROUTES.aiTeam],
            ["Company Context", ROUTES.context],
          ]
        : [
            ["How it works", ROUTES.howItWorks],
            ["Get started", ROUTES.signup],
            ["Log in", ROUTES.login],
          ],
    },
    {
      title: "Control",
      links: user
        ? [
            ["Approvals", ROUTES.approvals],
            ["Exceptions", ROUTES.exceptions],
            ["Usage", ROUTES.usage],
            ["Settings", ROUTES.settings],
          ]
        : [["Trust & safety", "/#trust"]],
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
    <footer className="ft no-print">
      <div className="wrap">
        <div className="cols" style={{ gridTemplateColumns: "1.6fr repeat(3, 1fr)" }}>
          <div>
            <Link href={ROUTES.home} className="lockup" style={{ color: "var(--ink)", gap: 10, display: "inline-flex" }} aria-label="Ensemblis home">
              <Mark size={24} />
              <span className="wm" style={{ fontSize: 19 }}>
                Ensemblis
              </span>
            </Link>
            <p className="small" style={{ marginTop: 12, maxWidth: "36ch" }}>
              The AI operating layer for business. Describe the outcome. We do the work.
            </p>
          </div>
          {cols.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <h4>{c.title}</h4>
              {c.links.map(([label, href]) => (
                <Link key={label} href={href}>
                  {label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
        <div className="row between wrapflex" style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
          <span>© 2026 Ensemblis</span>
          <span>AI-generated work can contain mistakes — review the evidence and verification before acting.</span>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
