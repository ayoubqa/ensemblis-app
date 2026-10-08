import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

const PLACES: { href: string; label: string; icon: IconName }[] = [
  { href: ROUTES.dashboard, label: "Chief of Staff", icon: "home" },
  { href: ROUTES.objectives, label: "Objectives", icon: "target" },
  { href: ROUTES.aiTeam, label: "AI Team", icon: "org" },
  { href: ROUTES.context, label: "Company Context", icon: "building" },
  { href: ROUTES.reports, label: "Reports", icon: "report" },
];

/** Themed 404 (Next's default one is hard-coded white and unreadable in dark mode). */
export default function NotFound() {
  return (
    <div className="wrap sh-404">
      <div className="sh-404-in">
        <span className="sh-404-code">
          <Icon name="compass" size={14} />
          Error 404
        </span>
        <h1>Page not found</h1>
        <p className="sh-404-lead">This page doesn&apos;t exist or has moved. Check the address, or continue from one of the places below.</p>
        <div className="sh-404-actions">
          <Link href={ROUTES.home} className="btn p lg">
            Back to Ensemblis
            <Icon name="arrow" />
          </Link>
          <Link href={ROUTES.howItWorksPage} className="btn lg">
            How Ensemblis works
          </Link>
        </div>
        <nav className="sh-404-links" aria-labelledby="sh-404-places">
          <h2 id="sh-404-places">Your workspace</h2>
          <ul>
            {PLACES.map((p) => (
              <li key={p.href}>
                <Link href={p.href}>
                  <Icon name={p.icon} />
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
