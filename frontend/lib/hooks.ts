"use client";

import { RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTypingTarget, storage } from "./utils";

export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Keeps a ref pointing at the latest value (for stable callbacks). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Calls `fn` every `intervalMs` while `enabled`. Pauses while the tab is hidden
 * and fires immediately when it becomes visible again. Return `false` from `fn`
 * (sync or async) to stop polling, e.g. once an execution finished.
 *
 *   usePolling(async () => { const { objective } = await api.getObjective(id); setObjective(objective);
 *     return objective.status === "RUNNING"; }, 2000);
 */
export function usePolling(
  fn: () => unknown | Promise<unknown>,
  intervalMs: number,
  opts: { enabled?: boolean; immediate?: boolean } = {}
) {
  const { enabled = true, immediate = true } = opts;
  const fnRef = useLatest(fn);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    const tick = async () => {
      if (stopped || running) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        schedule();
        return;
      }
      running = true;
      try {
        const r = await fnRef.current();
        if (r === false) {
          stopped = true;
          return;
        }
      } catch {
        /* keep polling on transient errors */
      } finally {
        running = false;
      }
      schedule();
    };
    const schedule = () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, intervalMs);
    };
    const onVis = () => {
      if (document.visibilityState === "visible" && !stopped) {
        if (timer) clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    if (immediate) tick();
    else schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, intervalMs, immediate, fnRef]);
}

type ShortcutOpts = {
  enabled?: boolean;
  /** Fire even while the user is typing in an input/textarea. Default false (true for mod+ combos). */
  allowInInputs?: boolean;
  preventDefault?: boolean;
};

function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop() as string;
  const mod = parts.includes("mod");
  const wantCtrl = parts.includes("ctrl");
  const wantMeta = parts.includes("meta");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  if (mod && !(e.metaKey || e.ctrlKey)) return false;
  if (!mod && (wantCtrl !== e.ctrlKey || wantMeta !== e.metaKey)) return false;
  if (wantAlt !== e.altKey) return false;
  const k = e.key.toLowerCase();
  // Keys like "?" or "/" already encode shift — only check shift for letters.
  if (/^[a-z]$/.test(key) && wantShift !== e.shiftKey) return false;
  const alias: Record<string, string> = { esc: "escape", enter: "enter", up: "arrowup", down: "arrowdown", space: " " };
  return k === (alias[key] || key);
}

/**
 * Global keyboard shortcut. `keys` accepts one combo or an array:
 * "mod+k" (⌘ on Mac, Ctrl elsewhere), "/", "?", "n", "shift+n", "esc".
 */
export function useKeyboardShortcut(keys: string | string[], handler: (e: KeyboardEvent) => void, opts: ShortcutOpts = {}) {
  const { enabled = true, allowInInputs, preventDefault = true } = opts;
  const h = useLatest(handler);
  const list = Array.isArray(keys) ? keys : [keys];
  const sig = list.join("|");
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented && !e.metaKey && !e.ctrlKey) return;
      for (const combo of sig.split("|")) {
        if (!matches(e, combo)) continue;
        const isMod = /mod\+|ctrl\+|meta\+/.test(combo);
        const allow = allowInInputs ?? isMod;
        if (!allow && isTypingTarget(e.target)) return;
        if (preventDefault) e.preventDefault();
        h.current(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sig, enabled, allowInInputs, preventDefault, h]);
}

/**
 * useState persisted to localStorage (JSON). Safe in private mode / SSR: the
 * first render always uses `initial`, the stored value is applied after mount.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const raw = storage.get(key);
    if (raw !== null) {
      try {
        setValue(JSON.parse(raw) as T);
      } catch {
        /* ignore corrupt value */
      }
    }
  }, [key]);
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        storage.set(key, JSON.stringify(next));
        return next;
      });
    },
    [key]
  );
  return [value, set];
}

/** Media query match; `false` during SSR / first render. */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [query]);
  return match;
}

export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** True below the prototype's 860px breakpoint. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 860px)");
}

/** Calls handler on pointerdown outside every given ref. */
export function useOnClickOutside(refs: Array<RefObject<HTMLElement>>, handler: () => void, enabled = true) {
  const h = useLatest(handler);
  useEffect(() => {
    if (!enabled) return;
    const on = (e: PointerEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current && r.current.contains(t))) return;
      h.current();
    };
    document.addEventListener("pointerdown", on);
    return () => document.removeEventListener("pointerdown", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, h, ...refs]);
}

/** IntersectionObserver visibility. `once` (default) stops observing after the first hit. */
export function useInView<T extends Element>(opts: { threshold?: number; rootMargin?: string; once?: boolean } = {}) {
  const { threshold = 0.15, rootMargin = "0px", once = true } = opts;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            if (once) io.disconnect();
          } else if (!once) setInView(false);
        }
      },
      { threshold, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, rootMargin, once]);
  return [ref, inView] as const;
}

/** true after the first client render (guards browser-only UI). */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** Debounced copy of a value. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
