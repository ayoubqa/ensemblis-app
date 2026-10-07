// Server-only helpers for `generateMetadata` on public report pages
// (/r/[token], /examples/[slug]). Never throws: a slow or missing backend just
// means generic metadata. Client code uses `api.*` instead.
import type { Metadata } from "next";
import { plainSummary } from "./shared";

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
    openGraph: { title: ogTitle, description, type: "article", siteName: "Ensemblis" },
    twitter: { card: "summary", title: ogTitle, description },
    ...(opts.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}
