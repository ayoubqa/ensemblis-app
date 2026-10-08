"use client";

import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export type ToastKind = "ok" | "bad" | "info";
export interface ToastOptions {
  kind?: ToastKind;
  icon?: IconName;
  /** ms before auto-dismiss (default 2600; errors 4200; with an action 8000). */
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

/** Renders the `#toasts` stack (bottom-center, above the mobile bottom bar). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const toast = useMemo(() => {
    const fn = ((message: string, opts: ToastOptions = {}) => {
      const id = ++seq.current;
      const kind = opts.kind ?? "ok";
      setItems((xs) => [...xs.slice(-3), { id, message, ...opts, kind }]);
      // Toasts with an action stay long enough to reach the button.
      setTimeout(() => dismiss(id), opts.duration ?? (opts.action ? 8000 : kind === "bad" ? 4200 : 2600));
    }) as ToastFn;
    fn.error = (m, o) => fn(m, { ...o, kind: "bad" });
    fn.info = (m, o) => fn(m, { ...o, kind: "info" });
    return fn;
  }, [dismiss]);

  const render = (t: ToastItem) => (
    <div key={t.id} className={`toast ${t.kind}`}>
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
    </div>
  );

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
 * toast.error("Couldn't reach the server");  // red alert icon, stays longer
 * toast.info("Copied", { icon: "copy" });
 */
export function useToast(): ToastFn {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast must be used within ToastProvider");
  return c;
}
