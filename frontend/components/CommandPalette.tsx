"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, type Objective } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { ROUTES } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import { fuzzyScore } from "@/lib/utils";
import { Icon, type IconName } from "./Icon";
import { Modal } from "./Modal";

export interface PaletteItem {
  id: string;
  title: string;
  sub: string;
  group: "Pages" | "Actions" | "Objectives";
  icon: IconName;
  href?: string;
  run?: () => void;
  keywords?: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onShortcuts: () => void;
}

/**
 * ⌘K palette: fuzzy search over pages, actions and the organization's
 * recent objectives (fetched when opened). ↑/↓ to move, Enter to go, Esc to close.
 */
export function CommandPalette({ open, onClose, onShortcuts }: CommandPaletteProps) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { toggle, resolved } = useTheme();
  const { config } = useConfig();
  const emailOn = config.emailEnabled;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lid = useId();

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    if (user) {
      api
        .listObjectives({ limit: 30 })
        .then((r) => setObjectives(r.objectives))
        .catch(() => setObjectives([]));
    }
  }, [open, user]);

  const items = useMemo<PaletteItem[]>(() => {
    const P = (id: string, title: string, href: string, icon: IconName, keywords = ""): PaletteItem => ({ id: "p:" + id, title: "Go to " + title, sub: "Page", group: "Pages", icon, href, keywords });
    const pages: PaletteItem[] = user
      ? [
          P("dash", "Dashboard", ROUTES.dashboard, "home", "briefing home overview chief of staff"),
          P("objectives", "Objectives", ROUTES.objectives, "list", "outcomes work history results executions"),
          P("team", "AI Team", ROUTES.aiTeam, "layers", "executives specialists capabilities organization chart"),
          P("context", "Company Context", ROUTES.context, "file", "company profile documents website memory"),
          P("approvals", "Approvals", ROUTES.approvals, "check", "approve plan budget authorize"),
          P("exceptions", "Exceptions", ROUTES.exceptions, "alert", "blocked attention problems"),
          P("usage", "Usage", ROUTES.usage, "wallet", "billing spend balance payments transactions budget"),
          P("routines", "Recurring objectives", ROUTES.routines, "redo", "routines recurring schedule weekly monthly"),
          P("members", "Organization members", ROUTES.members, "share", "team invite colleagues"),
          P("settings", "Settings", ROUTES.settings, "settings", "profile account password email verification autonomy approval threshold"),
          P("privacy", "Privacy Policy", ROUTES.privacy, "lock", "legal gdpr data"),
          P("terms", "Terms of Use", ROUTES.terms, "file", "legal conditions"),
        ]
      : [
          P("home", "Home", ROUTES.home, "home"),
          P("how", "How it works", ROUTES.howItWorks, "layers"),
          P("privacy", "Privacy Policy", ROUTES.privacy, "lock", "legal gdpr data"),
          P("terms", "Terms of Use", ROUTES.terms, "file", "legal conditions"),
        ];
    const A = (id: string, title: string, icon: IconName, run: () => void, keywords = ""): PaletteItem => ({ id: "a:" + id, title, sub: "Action", group: "Actions", icon, run, keywords });
    const actions: PaletteItem[] = [
      ...(user ? [{ ...A("new", "Define an outcome", "plus", () => router.push(ROUTES.newObjective), "new objective create start"), href: ROUTES.newObjective }] : []),
      A("theme", resolved === "dark" ? "Switch to light mode" : "Switch to dark mode", resolved === "dark" ? "sun" : "moon", toggle, "theme dark light appearance"),
      A("keys", "Keyboard shortcuts", "keyboard", onShortcuts, "help keys"),
      user?.isGuest
        ? { ...A("save", "Save your trial", "check", () => router.push(`${ROUTES.signup}?claim=1`), "create account sign up keep"), href: `${ROUTES.signup}?claim=1` }
        : user
          ? A("out", "Sign out", "out", () => {
              signOut();
              router.push(ROUTES.home);
            }, "log out logout")
          : A("in", "Log in", "user", () => router.push(ROUTES.login), "sign in"),
      ...(!user ? [{ ...A("join", "Get started", "spark", () => router.push(ROUTES.signup), "sign up register create account"), href: ROUTES.signup }] : []),
      ...(emailOn && !user ? [{ ...A("forgot", "Forgot password", "lock", () => router.push(ROUTES.forgotPassword), "reset password"), href: ROUTES.forgotPassword }] : []),
    ];
    const objs: PaletteItem[] = objectives.map((o) => ({
      id: "o:" + o.id,
      title: o.title,
      sub: "Objective · " + o.status.toLowerCase().replace(/_/g, " "),
      group: "Objectives",
      icon: "flag",
      href: ROUTES.objective(o.id),
      keywords: o.statement.slice(0, 300),
    }));
    return [...pages, ...actions, ...objs];
  }, [user, objectives, resolved, toggle, router, signOut, onShortcuts, emailOn]);

  const results = useMemo(() => {
    if (!q.trim()) {
      // No query: pages + actions, then the latest objectives.
      return items.filter((i) => i.group !== "Objectives").concat(items.filter((i) => i.group === "Objectives").slice(0, 5));
    }
    return items
      .map((it) => {
        // Best field wins; title beats keywords beats the "Page/Agent" label.
        const fields: [string, number][] = [
          [it.title.replace(/^Go to /, ""), 0],
          [it.title, -5],
          [it.keywords || "", -150],
          [it.sub, -300],
        ];
        let s = -1;
        for (const [text, weight] of fields) {
          const f = text ? fuzzyScore(q, text) : -1;
          if (f > 0) s = Math.max(s, f + weight);
        }
        return { it, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.it);
  }, [items, q]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    if (it.run) it.run();
    else if (it.href) router.push(it.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) setSel((s) => (s + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setSel((s) => (s - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[sel]);
    } else if (e.key === "Home" && e.ctrlKey) {
      setSel(0);
    }
  };

  let lastGroup = "";
  return (
    <Modal open={open} onClose={onClose} top wide className="palette" ariaLabel="Command palette" initialFocus={inputRef as React.RefObject<HTMLElement>}>
      <div className="pq">
        <Icon name="search" />
        <input
          ref={inputRef}
          className="f"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
          placeholder="Jump to a page, objective or action…"
          role="combobox"
          aria-expanded="true"
          aria-controls={lid}
          aria-activedescendant={results[sel] ? `${lid}-${sel}` : undefined}
          aria-autocomplete="list"
          aria-label="Search pages, objectives and actions"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="pres" id={lid} role="listbox" ref={listRef} aria-label="Results">
        {results.length ? (
          results.map((it, i) => {
            const head = !q.trim() && it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {head && (
                  <div className="pgrp" role="presentation">
                    {head}
                  </div>
                )}
                <div
                  id={`${lid}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === sel}
                  className="mrow"
                  onMouseMove={() => i !== sel && setSel(i)}
                  onClick={() => choose(it)}
                >
                  <span className="lead">
                    <Icon name={it.icon} />
                    <b className="small">{it.title}</b>
                  </span>
                  <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>
                    {it.sub}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <p className="small muted" style={{ padding: "14px 0" }}>
            No matches. Try an objective, a page or an action.
          </p>
        )}
      </div>
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Tip: <b>⌘K</b>/<b>Ctrl K</b> (or <b>/</b>) to open · <b>↑↓</b> to move · <b>Enter</b> to select · <b>?</b> for all shortcuts.
      </p>
    </Modal>
  );
}

export default CommandPalette;
