"use client";

import type { CSSProperties } from "react";
import type { TaskSource } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { hueFrom } from "@/lib/utils";
import { sourceDomId } from "./ReportMarkdown";
import { KIND_LABEL, prettyDate, safeHref, sortSources, sourceDomain, sourceInitial } from "./shared";
import s from "./report.module.css";

export interface SourcesPanelProps {
  sources: TaskSource[] | null | undefined;
  /** Id prefix shared with the report's citation chips. */
  idPrefix?: string;
  /** Number of the source to briefly highlight (after a citation click). */
  flash?: number | null;
  /** How many to show before "Show all". */
  limit?: number;
  expanded?: boolean;
  onExpand?: () => void;
  /** DOM id of the panel (TOC anchor). */
  id?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/** Numbered sources behind the report's [n] citations. */
export function SourcesPanel({
  sources,
  idPrefix = "r",
  flash = null,
  limit = 8,
  expanded = false,
  onExpand,
  id,
  title = "Sources",
  className,
  style,
}: SourcesPanelProps) {
  const list = sortSources(sources);
  if (!list.length) return null;
  const shown = expanded || list.length <= limit + 2 ? list : list.slice(0, limit);
  const mine = list.filter((x) => x.kind === "upload" || x.kind === "link").length;

  return (
    <section id={id} className={["card", s.sources, className].filter(Boolean).join(" ")} style={style} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="row between wrapflex" style={{ gap: 8 }}>
        <h3 id={id ? `${id}-h` : undefined} className="row" style={{ gap: 8 }}>
          <Icon name="link" />
          {title}
        </h3>
        <span className="tiny muted">
          {list.length} {list.length === 1 ? "source" : "sources"}
          {mine ? ` · ${mine} provided` : ""} · cited as [n]
        </span>
      </div>
      <ol className={s.srcList}>
        {shown.map((src) => {
          const domain = sourceDomain(src);
          const href = safeHref(src.url);
          const own = src.kind === "upload" || src.kind === "link";
          return (
            <li
              key={src.n}
              id={sourceDomId(idPrefix, src.n)}
              tabIndex={-1}
              className={[s.srcItem, flash === src.n && s.flash].filter(Boolean).join(" ")}
            >
              <span className={s.badge} style={{ ["--h" as string]: hueFrom(domain || src.title || String(src.n)) } as CSSProperties} aria-hidden="true">
                {src.kind === "upload" ? <Icon name="file" size={16} /> : sourceInitial(src)}
                <span className={s.badgeN}>{src.n}</span>
              </span>
              <div style={{ minWidth: 0 }}>
                <span className="sr-only">Source {src.n}: </span>
                {href ? (
                  <a className={s.srcTitle} href={href} target="_blank" rel="noopener noreferrer">
                    {src.title || domain || "Untitled source"}
                    <Icon name="ext" size={13} style={{ marginLeft: 5, verticalAlign: -1, color: "var(--muted)" }} />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span className={s.srcTitle}>{src.title || "Untitled source"}</span>
                )}
                <div className={s.srcMeta}>
                  <span className={[s.kind, own && s.kindMine].filter(Boolean).join(" ")}>{KIND_LABEL[src.kind] ?? "Source"}</span>
                  {domain && <span className={s.domain}>{domain}</span>}
                  {src.publishedAt && prettyDate(src.publishedAt) && <span>· {prettyDate(src.publishedAt)}</span>}
                </div>
                {src.snippet && <p className={s.snippet}>{src.snippet}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {shown.length < list.length && (
        <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={onExpand}>
          <Icon name="down" />
          Show all {list.length} sources
        </button>
      )}
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Sources are the evidence the AI Team worked from. Open them to check a claim before you rely on it.
      </p>
    </section>
  );
}
