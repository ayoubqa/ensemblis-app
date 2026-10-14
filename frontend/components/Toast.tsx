"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { Icon, type IconName } from "./Icon";

export type ToastKind = "ok" | "bad" | "info";
export interface ToastOptions {
  kind?: ToastKind;
  icon?: IconName;
  /** ms before auto-dismiss (default 2600; with an action 8000, paused while hovered or
   *  focused). Errors ignore it: they stay until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}
interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

export type ToastFn = ((message: string, opts?: ToastOptions) => void) & {
  error: (message: string, opts?: Omit<ToastOptions, "kind">) => void;
  info: (message: string, opts?: Omit<ToastOptions, "kind">) => void;
};

const Ctx = createContext<ToastFn | null>(null);

const ICON: Record<ToastKind, IconName> = { ok: "check", bad: "alert", info: "info" };

/**
 * One toast. Confirmations leave on their own; a toast with an action waits while the
 * pointer or focus is on it; errors stay until dismissed — so an error's text and its
 * buttons never vanish while someone is still reading them (WCAG 2.2.1).
 */
function ToastCard({ t, dismiss }: { t: ToastItem; dismiss: (id: number) => void }) {
  const sticky = t.kind === "bad";
  const closable = sticky || !!t.action;
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const paused = !!t.action && (hover || focus);
  const left = useRef(t.duration ?? (t.action ? 8000 : 2600));

  useEffect(() => {
    if (sticky || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss(t.id), left.current);
    return () => {
      window.clearTimeout(timer);
      // After a pause, leave at least a moment to reach the button again.
      left.current = Math.max(left.current - (Date.now() - started), 2000);
    };
  }, [sticky, paused, dismiss, t.id]);

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
  };

  return (
    <div
      className={`toast ${t.kind}`}
      onMouseEnter={t.action ? () => setHover(true) : undefined}
      onMouseLeave={t.action ? () => setHover(false) : undefined}
      onFocus={t.action ? () => setFocus(true) : undefined}
      onBlur={t.action ? onBlur : undefined}
    >
      <Icon name={t.icon ?? ICON[t.kind ?? "ok"]} />
      <span>{t.message}</span>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action!.onClick();
            dismiss(t.id);
          }}
        >
          {t.action.label}
        </button>
      )}
      {closable && (
        <button type="button" className="sh-toast-x" aria-label="Dismiss" title="Dismiss" onClick={() => dismiss(t.id)}>
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

/** Renders the `#toasts` stack (bottom-center, above the mobile bottom bar). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const toast = useMemo(() => {
    const fn = ((message: string, opts: ToastOptions = {}) => {
      const id = ++seq.current;
      const kind = opts.kind ?? "ok";
      // The same message again replaces the earlier copy (re-announced), so repeated
      // failures don't pile up errors that stay until dismissed.
      setItems((xs) => [...xs.filter((x) => !(x.kind === kind && x.message === message)).slice(-3), { id, message, ...opts, kind }]);
    }) as ToastFn;
    fn.error = (m, o) => fn(m, { ...o, kind: "bad" });
    fn.info = (m, o) => fn(m, { ...o, kind: "info" });
    return fn;
  }, []);

  const render = (t: ToastItem) => <ToastCard key={t.id} t={t} dismiss={dismiss} />;

  // Two persistent live regions (polite for confirmations, assertive for errors) so each
  // toast is announced exactly once.
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div id="toasts" className="no-print">
        <div className="sh-toast-region" role="status" aria-live="polite">
          {items.filter((t) => t.kind !== "bad").map(render)}
        </div>
        <div className="sh-toast-region" role="alert" aria-live="assertive">
          {items.filter((t) => t.kind === "bad").map(render)}
        </div>
      </div>
    </Ctx.Provider>
  );
}

/**
 * const toast = useToast();
 * toast("Recurring objective scheduled");    // ✓ success (default)
 * toast.error("Couldn't reach the server");  // red alert icon, stays until dismissed
 * toast.info("Copied", { icon: "copy" });
 */
export function useToast(): ToastFn {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used within ToastProvider");
  return c;
}
