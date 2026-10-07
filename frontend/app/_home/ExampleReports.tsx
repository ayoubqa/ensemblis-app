"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, Icon, Reveal, SkeletonCard } from "@/components";
import { api, type GalleryItem } from "@/lib/api";
import { ROUTES } from "@/lib/routes";
import S from "./home.module.css";

/** "https://www.example.com/a" → "example.com" */
function host(url: string | null, domain: string | null): string | null {
  if (domain) return domain.replace(/^www\./, "");
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function ExampleCard({ item }: { item: GalleryItem }) {
  const sources = Array.isArray(item.sources) ? item.sources : [];
  const cites = sources
    .map((s) => ({ n: s.n, label: host(s.url, s.domain) || (s.kind === "upload" ? "Uploaded file" : s.title) }))
    .filter((c) => !!c.label)
    .slice(0, 3);
  const depth = item.depth ? item.depth.charAt(0).toUpperCase() + item.depth.slice(1) : null;

  return (
    <Link href={ROUTES.example(item.slug)} className={`card acard ${S.exCard}`}>
      <div className={S.paper} aria-hidden="true">
        <div className={S.sheet}>
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        {cites.length > 0 && (
          <div className={S.cites}>
            {cites.map((c) => (
              <span key={c.n} className={S.cite}>
                <span>{c.n}</span>
                <em>{c.label}</em>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="row between" style={{ gap: 8 }}>
        <span className="eyebrow" style={{ margin: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {(item.category || "Report").toUpperCase()}
        </span>
        {item.isExample ? (
          <span className="tag gray" title="Written to demonstrate the format — not a real client deliverable">
            Example
          </span>
        ) : (
          <span className="tag ok" title="From a real Ensemblis task">
            <Icon name="star" size={12} />
            Featured
          </span>
        )}
      </div>
      <h3>{item.title}</h3>
      <p className={`small muted ${S.exSummary}`}>{item.summary}</p>
      <div className={S.exFacts}>
        {depth && (
          <span className={S.exFact}>
            <Icon name="layers" size={12} />
            {depth}
          </span>
        )}
        <span className={S.exFact}>
          <Icon name="link" size={12} />
          {sources.length} {sources.length === 1 ? "source" : "sources"}
        </span>
      </div>
      <div className={S.exFoot}>
        <Avatar name={item.agentName || "Ensemblis"} size="xs" />
        <b>{item.agentName}</b>
        <span className={S.exRead}>
          Read report
          <Icon name="arrow" size={14} />
        </span>
      </div>
    </Link>
  );
}

/**
 * "See a finished report": the first three gallery items. Shows skeletons
 * while loading and hides itself entirely if the gallery is empty or fails.
 */
export function ExampleReports({ onTry }: { onTry?: () => void }) {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listGallery()
      .then(({ items }) => {
        if (!alive) return;
        const list = Array.isArray(items) ? items.filter((it) => it && it.slug).slice(0, 3) : [];
        if (list.length) setItems(list);
        else setHidden(true);
      })
      .catch(() => alive && setHidden(true));
    return () => {
      alive = false;
    };
  }, []);

  if (hidden) return null;

  const anyExample = !!items?.some((it) => it.isExample);

  return (
    <section className="sect wrap" style={{ paddingTop: 24 }} aria-labelledby="home-examples">
      <div className="row between wrapflex" style={{ alignItems: "flex-end", marginBottom: 24, gap: 16 }}>
        <Reveal>
          <h2 id="home-examples" style={{ maxWidth: "20ch" }}>
            See a finished report
          </h2>
          <p className="muted" style={{ maxWidth: "58ch" }}>
            This is what a team of agents hands back: a structured report with numbered sources you can open and check.
            {anyExample && " Reports marked Example were written to show the format."}
          </p>
        </Reveal>
        <Link className="btn" href={ROUTES.examples}>
          Browse all examples <Icon name="arrow" />
        </Link>
      </div>
      {items === null ? (
        <div className="grid g3" aria-busy="true" aria-label="Loading example reports">
          {[0, 1, 2].map((k) => (
            <SkeletonCard key={k} />
          ))}
        </div>
      ) : (
        <div className="grid g3">
          {items.map((it, i) => (
            <Reveal key={it.slug} delay={i * 70} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <ExampleCard item={it} />
            </Reveal>
          ))}
        </div>
      )}
      {items !== null && onTry && (
        <div className={S.exMore}>
          <span className="small muted">Want one written for you?</span>
          <button type="button" className="btn p sm" onClick={onTry}>
            <Icon name="spark" size={14} />
            Try it free — no sign-up
          </button>
        </div>
      )}
    </section>
  );
}
