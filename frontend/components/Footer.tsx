import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import { Mark } from "./Logo";

const COLS: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      ["Work", ROUTES.newTask],
      ["Agents", ROUTES.agents],
      ["How it works", ROUTES.howItWorks],
      ["Pricing", ROUTES.pricing],
    ],
  },
  {
    title: "Developers",
    links: [
      ["Publish an agent", ROUTES.publish],
      ["Economics", ROUTES.economics],
      ["Developer dashboard", ROUTES.devDashboard],
    ],
  },
  {
    title: "Company",
    links: [
      ["The network", ROUTES.network],
      ["Brand", ROUTES.brand],
      ["Changelog", ROUTES.changelog],
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

/** Site footer (prototype `footer()`, `footer.ft`). Rendered once by the root layout. */
export function Footer() {
  return (
    <footer className="ft no-print">
      <div className="wrap">
        <div className="cols">
          <div>
            <Link href={ROUTES.home} className="lockup" style={{ color: "var(--ink)", gap: 10, display: "inline-flex" }} aria-label="Ensemblis home">
              <Mark size={24} />
              <span className="wm" style={{ fontSize: 19 }}>
                Ensemblis
              </span>
            </Link>
            <p className="small" style={{ marginTop: 12, maxWidth: "32ch" }}>
              The marketplace for AI work. Tell us what you need done. We&apos;ll find the right AI to do it.
            </p>
          </div>
          {COLS.map((c) => (
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
          <span>© 2026 Ensemblis · a demo project</span>
          <span>Performance figures shown are illustrative.</span>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
