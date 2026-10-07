// Small helpers shared by the report renderer and the exporters.
import type { Depth, TaskSource } from "@/lib/api";

export const AI_NOTE = "Produced by the AI Team — check the evidence and verification before relying on it.";

export const KIND_LABEL: Record<TaskSource["kind"], string> = {
  web: "Web",
  wikipedia: "Wikipedia",
  // Neutral wording: these labels also appear on public /r pages, the gallery and exports sent to other people.
  upload: "Provided file",
  link: "Provided link",
};

/** What the exporters print under the title. */
export interface ExportMeta {
  /** ISO date the report was delivered (defaults to today). */
  date?: string | null;
  depth?: Depth | null;
  /** Lead agent name. */
  agent?: string | null;
  /** Version number when the report has been refined (v2, v3…). */
  version?: number | null;
  /** A label such as "Example report" or "Shared report". */
  label?: string | null;
  /** Category, e.g. "Research". */
  category?: string | null;
}

export interface ExportInput {
  title: string;
  markdown: string;
  sources: TaskSource[];
  meta?: ExportMeta;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function sourceDomain(s: TaskSource): string | null {
  return (s.domain || hostOf(s.url) || "").replace(/^www\./, "") || null;
}

/** Only http(s) URLs are ever rendered as links. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

/** One-letter badge for a source (favicon-free on purpose: no third-party requests). */
export function sourceInitial(s: TaskSource): string {
  const base = sourceDomain(s) || s.title || "?";
  const ch = base.replace(/^(www\.|en\.|m\.)/, "").match(/[\p{L}\p{N}]/u)?.[0] ?? "?";
  return ch.toUpperCase();
}

export function depthLabel(d: Depth | null | undefined): string | null {
  return d ? `${d[0].toUpperCase()}${d.slice(1)} depth` : null;
}

export function fileSlug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "report"
  );
}

export function prettyDate(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** "12 March 2026 · Standard depth · Led by X · Version 2" */
export function metaLine(meta: ExportMeta | undefined): string {
  if (!meta) return prettyDate(null);
  return [
    meta.label,
    prettyDate(meta.date),
    depthLabel(meta.depth),
    meta.agent ? `Led by ${meta.agent}` : null,
    meta.version && meta.version > 1 ? `Version ${meta.version}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function sortSources(sources: TaskSource[] | null | undefined): TaskSource[] {
  return [...(sources ?? [])].filter((s) => s && Number.isFinite(s.n)).sort((a, b) => a.n - b.n);
}

/** Markdown appendix listing the sources, for .md export and Copy. */
export function sourcesAppendix(sources: TaskSource[]): string {
  const list = sortSources(sources);
  if (!list.length) return "";
  const lines = list.map((s) => {
    const url = safeHref(s.url);
    const title = s.title.replace(/[[\]]/g, "");
    const where = [sourceDomain(s), KIND_LABEL[s.kind]].filter(Boolean).join(" · ");
    return `${s.n}. ${url ? `[${title}](${url})` : title}${where ? ` — ${where}` : ""}`;
  });
  return `## Sources\n\n${lines.join("\n")}\n`;
}

/** The full Markdown file: title, meta, report, sources, AI note. */
export function buildMarkdownFile({ title, markdown, sources, meta }: ExportInput): string {
  const body = markdown.trim();
  const hasTitle = /^#\s+\S/.test(body);
  const head = hasTitle ? "" : `# ${title}\n\n`;
  const line = metaLine(meta);
  const metaMd = line ? `_${line}_\n\n` : "";
  const appendix = sourcesAppendix(sources);
  const withMeta = hasTitle ? body.replace(/^(#\s+[^\n]*\n)/, `$1\n${metaMd}`) : `${head}${metaMd}${body}`;
  return `${withMeta}\n\n${appendix ? `${appendix}\n` : ""}---\n\n_${AI_NOTE} Made with Ensemblis._\n`;
}

/** First real paragraph of a report as plain text (for previews / meta descriptions). */
export function plainSummary(md: string | null | undefined, max = 180): string {
  if (!md) return "";
  const paras = md
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !/^#{1,6}\s/.test(p) && !/^\|/.test(p) && !/^[-*_]{3,}$/.test(p));
  const first = paras[0] ?? "";
  const text = first
    .replace(/^[-*+]\s+|^\d+[.)]\s+/gm, "")
    .replace(/\[(\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*)\]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : text;
}

/** Robust clipboard write with the legacy textarea fallback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Download a Blob via a temporary anchor. Returns false when the browser
 * blocks it (the caller shows a toast with a fallback).
 */
export function saveBlob(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}
