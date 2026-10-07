// Unsent task draft, kept in sessionStorage so a logged-out visitor can
// describe a task, see the plan, sign in and come straight back to it.
import type { AttachmentKind, Depth } from "@/lib/api";

/** An uploaded attachment as remembered in the draft: server id + display meta only (never the text). */
export interface SavedAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  url: string | null;
  charCount: number;
  /** Set when the text was cut to fit the per-attachment limit. */
  truncatedTo: number | null;
  /** "Read 7 of 40 pages", "2 of 3 sheets"… */
  note: string | null;
  /** Who uploaded it — attachments are private to their uploader. */
  ownerId: string | null;
}

export interface Draft {
  description: string;
  depth: Depth;
  /** Chosen lead agent (id or slug); null = let Ensemblis pick. */
  agentId: string | null;
  attachments: SavedAttachment[];
}

const KEY = "ensemblis:new-task-draft";
const KINDS: AttachmentKind[] = ["pdf", "csv", "xlsx", "docx", "txt", "md", "url"];

function readAttachment(x: unknown): SavedAttachment | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  if (typeof a.id !== "string" || !a.id || typeof a.name !== "string") return null;
  if (!KINDS.includes(a.kind as AttachmentKind)) return null;
  return {
    id: a.id,
    kind: a.kind as AttachmentKind,
    name: a.name.slice(0, 300),
    url: typeof a.url === "string" ? a.url : null,
    charCount: typeof a.charCount === "number" && a.charCount >= 0 ? a.charCount : 0,
    truncatedTo: typeof a.truncatedTo === "number" ? a.truncatedTo : null,
    note: typeof a.note === "string" ? a.note.slice(0, 120) : null,
    ownerId: typeof a.ownerId === "string" ? a.ownerId : null,
  };
}

export function loadDraft(): Draft | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.description !== "string") return null;
    const depth: Depth = d.depth === "focused" || d.depth === "deep" ? d.depth : "standard";
    const attachments = Array.isArray(d.attachments)
      ? d.attachments.map(readAttachment).filter((a): a is SavedAttachment => !!a).slice(0, 20)
      : [];
    return { description: d.description, depth, agentId: typeof d.agentId === "string" ? d.agentId : null, attachments };
  } catch {
    return null;
  }
}

export function saveDraft(d: Draft) {
  try {
    if (!d.description.trim() && d.attachments.length === 0) window.sessionStorage.removeItem(KEY);
    else window.sessionStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable (private mode) */
  }
}

export function clearDraft() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const DEPTH_INFO: Record<Depth, { label: string; desc: string; mult: string }> = {
  focused: { label: "Focused", desc: "Specialist + report. Fastest and lowest cost.", mult: "−25%" },
  standard: { label: "Standard", desc: "Research, specialist analysis, then the report.", mult: "Base price" },
  deep: { label: "Deep", desc: "Adds an independent verification agent.", mult: "+50%" },
};

export const DEPTHS: Depth[] = ["focused", "standard", "deep"];

/** "2 files, 1 link" */
export function materialsSummary(items: { kind: AttachmentKind }[]): string {
  const links = items.filter((a) => a.kind === "url").length;
  const files = items.length - links;
  const parts: string[] = [];
  if (files) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
  if (links) parts.push(`${links} ${links === 1 ? "link" : "links"}`);
  return parts.join(", ");
}
