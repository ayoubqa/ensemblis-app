"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type GalleryItem } from "@/lib/api";
import { Avatar, ChipGroup, EmptyState, Icon, SkeletonCard } from "@/components";
import { errorText } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import { cx } from "@/lib/utils";
import E from "./examples.module.css";

const ALL = "All";

export function Gallery() {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState(ALL);

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    try {
      const { items } = await api.listGallery();
      setItems(Array.isArray(items) ? items : []);
    } catch (e) {
      setError(errorText(e, "Couldn't load the examples"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cats = useMemo(() => {
    const seen = new Map<string, number>();
    for (const it of items ?? []) if (it.category) seen.set(it.category, (seen.get(it.category) ?? 0) + 1);
    return Array.from(seen.keys()).sort((a, b) => a.localeCompare(b));
  }, [items]);
  const shown = (items ?? []).filter((it) => cat === ALL || it.category === cat);
  const featured = (items ?? []).filter((it) => !it.isExample).length;

  return (
    <>
      <section className={E.hero}>
        <div className="wrap">
          <span className="hx-badge">
            <span className="pulse" />
            Report gallery
          </span>
          <h1>See what a team of agents delivers.</h1>
          <p className={E.sub}>
            Finished reports, each with numbered sources you can open. Curated examples are labelled <b>Example</b>
            {featured > 0 ? (
              <>
                ; <b>Featured</b> ones come from real Ensemblis tasks.
              </>
            ) : (
              "."
            )}
          </p>
          <div className="row wrapflex" style={{ marginTop: 24 }}>
            <Link className="btn p lg" href={ROUTES.newTask}>
              Start your own task
              <Icon name="arrow" />
            </Link>
            <Link className="btn lg" href={ROUTES.howItWorks}>
              How it works
            </Link>
          </div>
        </div>
      </section>

      <div className="wrap" style={{ paddingBottom: 24 }}>
        {(cats.length > 1 || items === null) && (
          <div className={E.filters}>
            {items === null ? <span className="tiny muted">Loading categories…</span> : <ChipGroup options={[ALL, ...cats]} value={cat} onChange={setCat} label="Filter by category" />}
            {items !== null && (
              <span className="tiny muted" aria-live="polite">
                {shown.length} {shown.length === 1 ? "report" : "reports"}
              </span>
            )}
          </div>
        )}

        {error ? (
          <div className="notice" role="alert" style={{ alignItems: "center" }}>
            <Icon name="alert" />
            <span className="sp">{error}</span>
            <button type="button" className="btn sm" onClick={load}>
              Try again
            </button>
          </div>
        ) : items === null ? (
          <div className="grid g3" aria-busy="true" aria-label="Loading examples">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon="file" title="No example reports yet" action={{ label: "Start your own task", href: ROUTES.newTask, icon: "plus" }}>
            Examples will appear here soon. In the meantime, describe what you need and a team of agents will write it for you.
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState icon="filter" title={`No ${cat} reports yet`} action={{ label: "Show all reports", onClick: () => setCat(ALL) }} />
        ) : (
          <div className="grid g3">
            {shown.map((it) => (
              <Link key={it.slug} href={ROUTES.example(it.slug)} className={cx("card acard", E.card)}>
                <div className="row between" style={{ gap: 8 }}>
                  <span className="eyebrow" style={{ margin: 0 }}>
                    {(it.category || "Report").toUpperCase()}
                  </span>
                  {it.isExample ? (
                    <span className="tag gray" title="Written to demonstrate the format">
                      Example
                    </span>
                  ) : (
                    <span className="tag ok" title="From a real Ensemblis task">
                      <Icon name="star" size={12} />
                      Featured
                    </span>
                  )}
                </div>
                <h3>{it.title}</h3>
                <p className={cx("small muted", E.summary)}>{it.summary}</p>
                <div className={E.facts}>
                  <span className={E.fact} style={{ textTransform: "capitalize" }}>
                    <Icon name="layers" size={12} />
                    {it.depth}
                  </span>
                  <span className={E.fact}>
                    <Icon name="link" size={12} />
                    {(it.sources ?? []).length} {(it.sources ?? []).length === 1 ? "source" : "sources"}
                  </span>
                </div>
                <div className={E.foot}>
                  <Avatar name={it.agentName} size="xs" />
                  <b>{it.agentName}</b>
                  <span className="sp" />
                  <span className="muted row" style={{ gap: 4 }}>
                    Read
                    <Icon name="arrow" size={14} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
