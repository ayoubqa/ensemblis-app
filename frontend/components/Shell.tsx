"use client";

import { useRouter } from "next/navigation";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ROUTES } from "@/lib/routes";
import { isTypingTarget } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { Modal } from "./Modal";
import { RoleSelectModal, type SignupRole } from "./RoleSelect";

/** Every global shortcut (rendered in the "?" modal and the style guide). */
export const SHORTCUTS: [string, string][] = [
  ["⌘K / Ctrl K", "Open the command palette"],
  ["/", "Open the command palette"],
  ["↑ / ↓", "Move the palette selection"],
  ["Enter", "Open the selected palette result"],
  ["N", "Start a new task"],
  ["G then D", "Go to Dashboard"],
  ["G then T", "Go to My work"],
  ["G then A", "Go to Agents"],
  ["G then N", "Go to Network"],
  ["G then H", "Go home"],
  ["Esc", "Close the open modal or menu"],
  ["?", "Show this list"],
];

const GOTO: Record<string, string> = {
  d: ROUTES.dashboard,
  t: ROUTES.tasks,
  a: ROUTES.agents,
  n: ROUTES.network,
  h: ROUTES.home,
  w: ROUTES.workflows,
  b: ROUTES.billing,
  s: ROUTES.settings,
};

interface ShellCtx {
  openPalette: () => void;
  openShortcuts: () => void;
  /** Opens the "How will you use Ensemblis?" role picker → /signup?type=… */
  openRoleSelect: (opts?: { role?: SignupRole; next?: string }) => void;
  closeAll: () => void;
}
const Ctx = createContext<ShellCtx | null>(null);

/**
 * App-wide overlays + keyboard shortcuts: command palette (⌘K, Ctrl K, /),
 * shortcuts sheet (?), role-select signup modal, N = new task, G-then-X go-to.
 */
export function ShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [role, setRole] = useState<{ open: boolean; role?: SignupRole; next?: string }>({ open: false });
  const gPending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeAll = useCallback(() => {
    setPalette(false);
    setShortcuts(false);
    setRole({ open: false });
  }, []);
  const openPalette = useCallback(() => {
    setShortcuts(false);
    setRole({ open: false });
    setPalette(true);
  }, []);
  const openShortcuts = useCallback(() => {
    setPalette(false);
    setShortcuts(true);
  }, []);
  const openRoleSelect = useCallback((opts?: { role?: SignupRole; next?: string }) => {
    setPalette(false);
    setShortcuts(false);
    setRole({ open: true, ...opts });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K / Ctrl K toggles the palette from anywhere, even inside inputs.
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        setPalette((p) => !p);
        setShortcuts(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector(".scrim")) return; // a modal owns the keyboard
      const k = e.key;
      if (gPending.current) {
        clearTimeout(gPending.current);
        gPending.current = null;
        const dest = GOTO[k.toLowerCase()];
        if (dest) {
          e.preventDefault();
          router.push(dest);
        }
        return;
      }
      if (k === "/") {
        e.preventDefault();
        openPalette();
      } else if (k === "?") {
        e.preventDefault();
        openShortcuts();
      } else if (k === "n" || k === "N") {
        e.preventDefault();
        router.push(ROUTES.newTask);
      } else if (k === "g" || k === "G") {
        gPending.current = setTimeout(() => (gPending.current = null), 1200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, openPalette, openShortcuts]);

  const value = useMemo(() => ({ openPalette, openShortcuts, openRoleSelect, closeAll }), [openPalette, openShortcuts, openRoleSelect, closeAll]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <CommandPalette open={palette} onClose={() => setPalette(false)} onShortcuts={openShortcuts} onGetStarted={() => openRoleSelect()} />
      <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
      <RoleSelectModal open={role.open} initialRole={role.role ?? null} next={role.next} onClose={() => setRole({ open: false })} />
    </Ctx.Provider>
  );
}

export function useShell(): ShellCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell must be used within ShellProvider");
  return c;
}

/** Keyboard shortcuts sheet (prototype `shortcutsHtml`). */
export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <div style={{ marginTop: 14 }}>
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="row between" style={{ padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
            <span className="small muted">{d}</span>
            <b className="small" style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>
              {k}
            </b>
          </div>
        ))}
      </div>
      <button type="button" className="btn p" style={{ width: "100%", marginTop: 16 }} onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}
