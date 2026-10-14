"use client";

import { useRouter } from "next/navigation";
import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, type Attention } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { isTypingTarget, storage } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { Modal } from "./Modal";
import { useModKey } from "./UI";

// ------------------------------------------------------------------ shortcuts
/** Every global shortcut, as plain text (rendered by the "?" sheet; kept for compatibility). */
export const SHORTCUTS: [string, string][] = [
  ["⌘K / Ctrl K", "Open the command palette"],
  ["/", "Open the command palette"],
  ["?", "Show keyboard shortcuts"],
  ["N", "Define a new outcome"],
  ["G then H (or D)", "Go to Home — the Chief of Staff"],
  ["G then O", "Go to Objectives"],
  ["G then T", "Go to AI Team"],
  ["G then C", "Go to Company Context"],
  ["G then P", "Go to Reports"],
  ["G then A", "Go to Approvals"],
  ["G then E", "Go to Exceptions"],
  ["G then U", "Go to Usage"],
  ["G then R", "Go to Recurring objectives"],
  ["G then S", "Go to Settings"],
  ["↑ / ↓", "Move the palette selection"],
  ["Enter", "Open the selected palette result"],
  ["Esc", "Close the open dialog or menu"],
];

/** G-then-letter destinations. */
const GOTO: Record<string, string> = {
  h: ROUTES.dashboard, // "Home" in the navigation is the Chief of Staff
  d: ROUTES.dashboard,
  o: ROUTES.objectives,
  t: ROUTES.aiTeam,
  c: ROUTES.context,
  p: ROUTES.reports,
  a: ROUTES.approvals,
  e: ROUTES.exceptions,
  u: ROUTES.usage,
  r: ROUTES.routines,
  s: ROUTES.settings,
};

/** localStorage: "off" disables the single-character shortcuts (WCAG 2.1.4). */
export const SINGLE_KEY_PREF = "ensemblis_single_key_shortcuts";

// ------------------------------------------------------------------ attention
/** Pending approvals / open exceptions / executions in progress, for the nav badges (polled every 60s, paused in hidden tabs). */
export function useAttention(enabled: boolean) {
  const [counts, setCounts] = useState<Attention | null>(null);
  const load = useCallback(async () => {
    setCounts(await api.attention());
  }, []);
  usePolling(load, 60_000, { enabled });
  useEffect(() => {
    if (!enabled) setCounts(null);
  }, [enabled]);
  // Pages that change counts (approve, resolve) ask for a refresh.
  useEffect(() => {
    if (!enabled) return;
    const on = () => void load().catch(() => undefined);
    window.addEventListener("ensemblis:attention", on);
    return () => window.removeEventListener("ensemblis:attention", on);
  }, [enabled, load]);
  return counts;
}

/** Call after approving / resolving something so the attention badges update immediately. */
export function refreshAttention() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("ensemblis:attention"));
}

export { useModKey };

// ------------------------------------------------------------------ provider
interface ShellCtx {
  openPalette: () => void;
  openShortcuts: () => void;
  closeAll: () => void;
  /** Shared attention counts (one poll for the header and the mobile bar); null when signed out or loading. */
  attention: Attention | null;
  /** Single-character shortcuts (/, ?, N, G-then-X) are on. They only ever fire for signed-in people. */
  singleKeys: boolean;
  setSingleKeys: (on: boolean) => void;
}
const Ctx = createContext<ShellCtx | null>(null);

/**
 * App-wide overlays + keyboard shortcuts: command palette (⌘K / Ctrl K anywhere;
 * "/" when signed in), shortcuts sheet (?), N = define an outcome, G-then-X go-to.
 * Single-character shortcuts only work for signed-in people and can be turned off.
 */
export function ShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const signedIn = !!user;
  const attention = useAttention(signedIn);
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [singleKeys, setSingleKeysState] = useState(true);
  const gPending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSingleKeysState(storage.get(SINGLE_KEY_PREF) !== "off");
  }, []);
  const setSingleKeys = useCallback((on: boolean) => {
    storage.set(SINGLE_KEY_PREF, on ? null : "off");
    setSingleKeysState(on);
  }, []);

  const closeAll = useCallback(() => {
    setPalette(false);
    setShortcuts(false);
  }, []);
  const openPalette = useCallback(() => {
    setShortcuts(false);
    setPalette(true);
  }, []);
  const openShortcuts = useCallback(() => {
    setPalette(false);
    setShortcuts(true);
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
      // Single-character shortcuts: signed-in people only, and only when switched on.
      if (!signedIn || !singleKeys) return;
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
        router.push(ROUTES.newObjective);
      } else if (k === "g" || k === "G") {
        gPending.current = setTimeout(() => (gPending.current = null), 1200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, openPalette, openShortcuts, signedIn, singleKeys]);

  useEffect(
    () => () => {
      if (gPending.current) clearTimeout(gPending.current);
    },
    []
  );

  const value = useMemo(
    () => ({ openPalette, openShortcuts, closeAll, attention, singleKeys, setSingleKeys }),
    [openPalette, openShortcuts, closeAll, attention, singleKeys, setSingleKeys]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <CommandPalette open={palette} onClose={() => setPalette(false)} onShortcuts={openShortcuts} />
      <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
    </Ctx.Provider>
  );
}

export function useShell(): ShellCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell must be used within ShellProvider");
  return c;
}

// ------------------------------------------------------------------ shortcuts sheet
type Keys = (string | { sep: string })[];
const or = { sep: "or" };
const then = { sep: "then" };

/** Grouped, rendered form of SHORTCUTS. `single` marks single-character shortcuts. */
function shortcutGroups(mod: string): { title: string; items: { keys: Keys; label: string; single?: boolean }[] }[] {
  const go = (letter: string, label: string, alt?: string) => ({ keys: ["G", then, letter, ...(alt ? [or, alt] : [])] as Keys, label, single: true });
  return [
    {
      title: "Anywhere",
      items: [
        { keys: [mod, "K"], label: "Open the command palette" },
        { keys: ["/"], label: "Open the command palette", single: true },
        { keys: ["N"], label: "Define a new outcome", single: true },
        { keys: ["?"], label: "Show keyboard shortcuts", single: true },
        { keys: ["Esc"], label: "Close the open dialog or menu" },
      ],
    },
    {
      title: "Go to",
      items: [
        go("H", "Home — the Chief of Staff", "D"),
        go("O", "Objectives"),
        go("T", "AI Team"),
        go("C", "Company Context"),
        go("P", "Reports"),
        go("A", "Approvals"),
        go("E", "Exceptions"),
        go("U", "Usage"),
        go("R", "Recurring objectives"),
        go("S", "Settings"),
      ],
    },
    {
      title: "In the command palette",
      items: [
        { keys: ["↑", "↓"], label: "Move the selection" },
        { keys: ["Enter"], label: "Open the selected result" },
      ],
    },
  ];
}

/** Keyboard shortcuts sheet: every shortcut, grouped, plus the single-key switch. */
export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useContext(Ctx);
  const { user } = useAuth();
  const mod = useModKey();
  const switchId = useId();
  const singleOn = ctx?.singleKeys ?? true;
  const active = !!user && singleOn;
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" wide className="sh-keys">
      <p className="sh-keys-lead">Move around Ensemblis without leaving the keyboard. Shortcuts never fire while you type in a field.</p>
      <div className="sh-keys-grid">
        {shortcutGroups(mod).map((g) => (
          <div key={g.title} className="sh-keys-group">
            <h4>{g.title}</h4>
            <dl>
              {g.items.map((it) => (
                <div key={it.label + it.keys.join("")} className={it.single && !active ? "sh-key-off" : undefined}>
                  <dt>{it.label}</dt>
                  <dd>
                    {it.keys.map((k, i) =>
                      typeof k === "string" ? (
                        <kbd key={i} className="kbd">
                          {k}
                        </kbd>
                      ) : (
                        <span key={i} className="sh-key-sep">
                          {k.sep}
                        </span>
                      )
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <div className="sh-keys-foot">
        {user ? (
          <label className="sh-switch" htmlFor={switchId}>
            <input id={switchId} type="checkbox" role="switch" checked={singleOn} onChange={(e) => ctx?.setSingleKeys(e.target.checked)} />
            <span className="sh-switch-track" aria-hidden="true" />
            <span>
              <b>Single-key shortcuts</b>
              <span className="sh-switch-hint">/, ?, N and G-then-letter. Turn off if you use speech input or press keys by accident.</span>
            </span>
          </label>
        ) : (
          <p className="sh-switch-hint">Single-key shortcuts work once you&apos;re signed in. {mod} K works everywhere.</p>
        )}
        <button type="button" className="btn p" onClick={onClose} data-autofocus>
          Done
        </button>
      </div>
    </Modal>
  );
}
