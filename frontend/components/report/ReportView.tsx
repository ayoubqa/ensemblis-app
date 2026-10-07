"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TaskSource } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { CiteProvider, ReportMarkdown, sourceDomId } from "./ReportMarkdown";
import { SourcesPanel } from "./SourcesPanel";
import { AI_NOTE, fileSlug, sortSources } from "./shared";
import s from "./report.module.css";

export type ReportSection = { id: string; title: string | null; md: string };

const plainInline = (t: string) =>
  t
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[(\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*)\]/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();

/** Split a report on `## ` headings (outside code fences); pull out a leading `# ` title. */
export function splitReport(md: string, prefix = "r"): { h1: string | null; sections: ReportSection[] } {
  const lines = (md || "").replace(/\r\n?/g, "\n").split("\n");
  let h1: string | null = null;
  let fence = false;
  let cur: ReportSection = { id: `${prefix}-overview`, title: null, md: "" };
  const out: ReportSection[] = [];
  const used = new Set<string>();
  const uid = (t: string) => {
    const base = `${prefix}-${fileSlug(t)}`;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    return id;
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence) {
      const m1 = /^#\s+(.+?)\s*#*\s*$/.exec(line);
      if (m1 && h1 === null && out.length === 0 && !cur.md.trim()) {
        h1 = plainInline(m1[1]);
        continue;
      }
      const m2 = /^##\s+(.+?)\s*#*\s*$/.exec(line);
      if (m2) {
        if (cur.md.trim() || cur.title) out.push(cur);
        const title = plainInline(m2[1]) || "Section";
        cur = { id: uid(title), title, md: "" };
        continue;
      }
    }
    cur.md += line + "\n";
  }
  if (cur.md.trim() || cur.title) out.push(cur);
  return { h1, sections: out };
}

/** The report's own `# Title`, if any. */
export function reportTitle(md: string | null | undefined): string | null {
  return md ? splitReport(md).h1 : null;
}

export interface ReportViewProps {
  markdown: string;
  sources?: TaskSource[] | null;
  /** Unique per page when several reports could render (default "r"). */
  idPrefix?: string;
  /** Replaces the AI disclaimer line; pass `false` to hide it. */
  disclaimer?: ReactNode | false;
  /** Extra TOC entries after Sources (e.g. "How this was produced"). */
  tocExtra?: { id: string; label: string }[];
  /** Rendered above the report card (version switcher, materials…). */
  before?: ReactNode;
  /** Rendered after the Sources panel, in the same column. */
  children?: ReactNode;
  /** Shown when the markdown is empty. */
  emptyText?: ReactNode;
  className?: string;
}

/**
 * The premium report reader: sticky contents, sections, citation chips with
 * source popovers, and a numbered Sources panel. Used by the objective console,
 * the public share page and the examples gallery.
 */
export function ReportView({ markdown, sources, idPrefix = "r", disclaimer, tocExtra = [], before, children, emptyText, className }: ReportViewProps) {
  const { sections } = useMemo(() => splitReport(markdown, idPrefix), [markdown, idPrefix]);
  const list = useMemo(() => sortSources(sources), [sources]);
  const sourcesId = `${idPrefix}-sources`;
  const toc = useMemo(
    () => [
      ...sections.filter((x) => x.title).map((x) => ({ id: x.id, label: x.title as string, count: null as number | null })),
      ...(list.length ? [{ id: sourcesId, label: "Sources", count: list.length }] : []),
      ...tocExtra.map((x) => ({ ...x, count: null })),
    ],
    [sections, list.length, sourcesId, tocExtra]
  );
  const sectionEntries = sections.filter((x) => x.title).length;
  const tocKey = toc.map((x) => x.id).join("|");
  const [active, setActive] = useState<string | null>(toc[0]?.id ?? null);
  const [flash, setFlash] = useState<number | null>(null);
  const [allSources, setAllSources] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Highlight the TOC entry for the section in view.
  useEffect(() => {
    if (!toc.length || typeof IntersectionObserver === "undefined") return;
    const els = toc.map((x) => document.getElementById(x.id)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-90px 0px -60% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tocKey]);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const reduce = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: reduce() ? "auto" : "smooth", block: "start" });
    setActive(id);
  };

  const jumpToSource = useCallback(
    (n: number) => {
      const index = list.findIndex((x) => x.n === n);
      if (index < 0) return;
      if (index >= 8 && list.length > 10) setAllSources(true);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.getElementById(sourceDomId(idPrefix, n));
          if (!el) return;
          el.scrollIntoView({ behavior: reduce() ? "auto" : "smooth", block: "center" });
          el.focus({ preventScroll: true });
          setFlash(null);
          requestAnimationFrame(() => setFlash(n));
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlash(null), 1900);
        })
      );
    },
    [list, idPrefix]
  );

  const note =
    disclaimer === false ? null : (
      <p className={`small muted ${s.note}`} role="note">
        <Icon name="info" size={15} style={{ flex: "none", marginTop: 2, color: "var(--warn)" }} />
        <span>{disclaimer ?? AI_NOTE}</span>
      </p>
    );

  return (
    <CiteProvider sources={list} jump={jumpToSource} prefix={idPrefix}>
      <div className={["report", className].filter(Boolean).join(" ")} style={toc.length ? undefined : { gridTemplateColumns: "minmax(0,1fr)" }}>
        {toc.length > 0 && (
          <aside className="toc" aria-label="Report contents">
            <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 8, paddingLeft: 14 }}>
              Contents
            </div>
            <nav>
              {toc.map((x, i) => (
                <a
                  key={x.id}
                  href={`#${x.id}`}
                  className={active === x.id ? s.tocOn : undefined}
                  aria-current={active === x.id ? "location" : undefined}
                  style={i > 0 && i === sectionEntries ? { marginTop: 10 } : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    jumpTo(x.id);
                  }}
                >
                  {x.label}
                  {x.count !== null && <span className={s.tocCount}>{x.count}</span>}
                </a>
              ))}
            </nav>
          </aside>
        )}
        <div style={{ minWidth: 0 }}>
          {before}
          {note}
          <article className={`card ${s.article}`} aria-label="Report">
            {sections.length === 0 ? (
              <div className="rsec" style={{ borderBottom: 0 }}>
                <p className="muted">{emptyText ?? "This report is empty."}</p>
              </div>
            ) : (
              sections.map((sec, i) => (
                <section
                  key={sec.id}
                  id={sec.id}
                  className="rsec"
                  style={{ scrollMarginTop: 84, ...(i === sections.length - 1 ? { borderBottom: 0 } : {}) }}
                >
                  {sec.title && <h2>{sec.title}</h2>}
                  <ReportMarkdown sources={list}>{sec.md}</ReportMarkdown>
                </section>
              ))
            )}
          </article>
          <SourcesPanel
            id={sourcesId}
            sources={list}
            idPrefix={idPrefix}
            flash={flash}
            expanded={allSources}
            onExpand={() => setAllSources(true)}
          />
          {children}
        </div>
      </div>
    </CiteProvider>
  );
}
