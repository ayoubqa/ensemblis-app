"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useStartHref } from "@/components/site/StartLink";
import { TrackedLink } from "@/components/site/TrackedLink";
import { analyticsEnabled, track } from "@/lib/analytics";
import type { Cta } from "@/lib/blog/cta";

/** The single call to action at the end of an article — matched to the article, never mid-text. */
export function ArticleCta({ cta, slug }: { cta: Cta; slug: string }) {
  const start = useStartHref();
  const href = cta.kind === "start" ? start : cta.href;
  return (
    <aside className="ed-cta" aria-labelledby="ed-cta-h">
      <p className="ed-cta-eyebrow">{cta.eyebrow}</p>
      <h2 id="ed-cta-h">{cta.title}</h2>
      <p>{cta.body}</p>
      <TrackedLink href={href} event="blog_cta_click" props={{ slug, cta: cta.key }} className="btn p">
        {cta.label}
        <Icon name="arrow" />
      </TrackedLink>
    </aside>
  );
}

/** Share without third-party scripts: plain share URLs and a copy button. */
export function ShareLinks({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the links still work */
    }
  };
  return (
    <div className="ed-share" role="group" aria-label="Share this article">
      <span className="ed-share-h">Share</span>
      <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`} rel="noopener" target="_blank">
        LinkedIn
      </a>
      <a href={`https://x.com/intent/post?url=${enc(url)}&text=${enc(title)}`} rel="noopener" target="_blank">
        X
      </a>
      <a href={`mailto:?subject=${enc(title)}&body=${enc(url)}`}>Email</a>
      <button type="button" onClick={copy} aria-live="polite">
        {copied ? "Link copied" : "Copy link"}
      </button>
    </div>
  );
}

/**
 * Reports `article_read_complete` once, when the end of the article text scrolls into view — the closest
 * honest signal that someone read rather than bounced. Renders an invisible marker; does nothing unless
 * analytics is enabled.
 */
export function ReadComplete({ slug, layer }: { slug: string; layer: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!analyticsEnabled || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        track("article_read_complete", { slug, layer });
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [slug, layer]);
  return <div ref={ref} className="ed-read-end" aria-hidden="true" />;
}
