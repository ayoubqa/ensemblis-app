// Unsent task draft, kept in sessionStorage so a logged-out visitor can
// describe a task, see the plan, sign in and come straight back to it.
import type { Depth } from "@/lib/api";

export interface Draft {
  description: string;
  depth: Depth;
  /** Chosen lead agent (id or slug); null = let Ensemblis pick. */
  agentId: string | null;
}

const KEY = "ensemblis:new-task-draft";

export function loadDraft(): Draft | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.description !== "string") return null;
    const depth: Depth = d.depth === "focused" || d.depth === "deep" ? d.depth : "standard";
    return { description: d.description, depth, agentId: typeof d.agentId === "string" ? d.agentId : null };
  } catch {
    return null;
  }
}

export function saveDraft(d: Draft) {
  try {
    if (!d.description.trim()) window.sessionStorage.removeItem(KEY);
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
