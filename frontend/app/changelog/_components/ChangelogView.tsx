import Link from "next/link";
import { Icon } from "@/components";
import { CHANGELOG } from "@/lib/data";
import { ROUTES } from "@/lib/routes";

const slug = (s: string) => s.toLowerCase().replace(/\s+/g, "-");

export function ChangelogView() {
  return (
    <div className="wrap">
      <div className="pagehead">
        <div className="eyebrow">CHANGELOG</div>
        <h1>What&apos;s new in Ensemblis.</h1>
        <p>A running log of product updates. This is a demo environment, so dates are illustrative.</p>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,720px) 1fr", gap: 32, alignItems: "start" }} id="ag">
        <div className="stack" style={{ marginBottom: 40 }}>
          {CHANGELOG.map((r, i) => (
            <section key={r.date} id={slug(r.date)} className="card tight reveal" style={{ animationDelay: `${i * 70}ms`, scrollMarginTop: 90 }}>
              <div className="row between" style={{ marginBottom: 10 }}>
                <span className="tag gray">{r.date}</span>
                {i === 0 && <span className="tag">Latest</span>}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {r.items.map((it) => (
                  <li key={it} className="small" style={{ marginBottom: 6 }}>
                    {it}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <aside className="hideM" style={{ position: "sticky", top: 90 }}>
          <div className="eyebrow">RELEASES</div>
          <nav aria-label="Releases" className="stack" style={{ gap: 8 }}>
            {CHANGELOG.map((r) => (
              <a key={r.date} href={`#${slug(r.date)}`} className="small muted" style={{ display: "block" }}>
                {r.date} <span className="tiny">· {r.items.length} {r.items.length === 1 ? "update" : "updates"}</span>
              </a>
            ))}
          </nav>
          <div className="card tight" style={{ marginTop: 20 }}>
            <b className="small">Try the latest</b>
            <p className="tiny muted" style={{ margin: "4px 0 10px" }}>
              Press <kbd className="kbd">⌘K</kbd> anywhere to open the command palette.
            </p>
            <Link className="btn sm" href={ROUTES.newTask}>
              New task <Icon name="arrow" />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
