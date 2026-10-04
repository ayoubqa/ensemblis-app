"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { storage } from "./utils";

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "ensemblis_theme";

/**
 * Inline <head> script: applies the stored theme before first paint (no flash).
 * <html data-theme> always holds the RESOLVED theme ("light" | "dark");
 * <html data-theme-pref> holds the preference ("light" | "dark" | "system").
 */
export const themeInitScript = `(function(){try{var p=null;try{p=localStorage.getItem('${THEME_KEY}')}catch(e){}if(p!=='light'&&p!=='dark')p='system';var d=p==='dark'||(p==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.setAttribute('data-theme',d?'dark':'light');r.setAttribute('data-theme-pref',p);}catch(e){}})();`;

interface ThemeCtx {
  /** User preference */
  theme: ThemePref;
  /** What is actually showing */
  resolved: ResolvedTheme;
  setTheme: (t: ThemePref) => void;
  /** Flip between light and dark (sets an explicit preference). */
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function systemDark() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(pref: ThemePref): ResolvedTheme {
  const resolved: ResolvedTheme = pref === "dark" || (pref === "system" && systemDark()) ? "dark" : "light";
  const r = document.documentElement;
  r.setAttribute("data-theme", resolved);
  r.setAttribute("data-theme-pref", pref);
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const p = storage.get(THEME_KEY);
    const pref: ThemePref = p === "light" || p === "dark" ? p : "system";
    setThemeState(pref);
    setResolved(apply(pref));
  }, []);

  // Follow the OS while on "system".
  useEffect(() => {
    if (theme !== "system" || !window.matchMedia) return;
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setResolved(apply("system"));
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [theme]);

  const setTheme = useCallback((t: ThemePref) => {
    storage.set(THEME_KEY, t === "system" ? null : t);
    setThemeState(t);
    setResolved(apply(t));
  }, []);

  const toggle = useCallback(() => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark";
    setTheme(cur ? "light" : "dark");
  }, [setTheme]);

  const value = useMemo(() => ({ theme, resolved, setTheme, toggle }), [theme, resolved, setTheme, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
}
