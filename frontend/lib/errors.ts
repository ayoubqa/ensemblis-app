import { ApiError } from "./api";
import type { ToastFn } from "@/components/Toast";

/** 429 (rate / daily limit) or 403 (not allowed on this demo, e.g. top-ups off, invite needed). */
export function isLimitError(e: unknown): e is ApiError {
  return e instanceof ApiError && (e.status === 429 || e.status === 403);
}

/** The server's message when it sent one, otherwise a friendly fallback. */
export function errorText(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof ApiError) {
    if (e.message && !/^Request failed \(\d+\)$/.test(e.message)) return e.message;
    if (e.status === 429) return "You've hit this demo's usage limit. Please try again later.";
    if (e.status === 403) return "That isn't available on this demo.";
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Show an API error as a toast. Limit errors (429/403) stay on screen longer
 * with a clock/lock icon so the server's explanation can actually be read.
 */
export function toastApiError(toast: ToastFn, e: unknown, fallback?: string) {
  const msg = errorText(e, fallback);
  if (e instanceof ApiError && e.status === 429) toast.error(msg, { icon: "clock", duration: 8000 });
  else if (e instanceof ApiError && e.status === 403) toast.error(msg, { icon: "lock", duration: 8000 });
  else toast.error(msg);
}
