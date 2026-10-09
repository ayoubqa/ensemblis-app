// Server-only helpers for `generateMetadata` on public report pages
// (/r/[token]). Never throws: a slow or missing backend just
// means generic metadata. Client code uses `api.*` instead.
import type { Metadata } from "next";
import { plainSummary } from "./shared";

const OG_IMAGE = { url: "/brand/og-image.png", width: 1200, height: 630, alt: "Ensemblis — the AI operating layer for business" };

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

export async function fetchPublicJson<T>(path: string, timeoutMs = 3000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, { cache: "no-store", signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Title/description/OpenGraph for a report page (the root layout appends " · Ensemblis"). */
export function reportMetadata(opts: {
  title: string;
  markdown?: string | null;
  fallbackDescription: string;
  kicker?: string;
  noindex?: boolean;
}): Metadata {
  const description = plainSummary(opts.markdown, 180) || opts.fallbackDescription;
  const ogTitle = opts.kicker ? `${opts.title} · ${opts.kicker}` : opts.title;
  return {
    title: opts.title,
    description,
    // Next merges metadata shallowly: repeat the brand image and locale, or previews lose them.
    openGraph: { title: ogTitle, description, type: "article", siteName: "Ensemblis", locale: "en_US", images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: ogTitle, description, images: [OG_IMAGE.url] },
    ...(opts.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}
