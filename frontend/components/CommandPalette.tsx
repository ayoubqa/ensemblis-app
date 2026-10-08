"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, type Objective } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { ROUTES } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import { fuzzyScore } from "@/lib/utils";
import { Icon, type IconName } from "./Icon";
import { Modal } from "./Modal";
import { statusLabel } from "./Tags";
import { useModKey } from "./UI";

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
 * ⌘K / Ctrl K palette: fuzzy search over pages, actions and the organization's
 * recent objectives (fetched when opened). ↑/↓ to move, Enter to go, Esc to close.
 * Guests don't see members/settings (they have neither).
 */
export function CommandPalette({ open, onClose, onShortcuts }: CommandPaletteProps) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { theme, setTheme, toggle, resolved } = useTheme();
  const { config } = useConfig();
  const mod = useModKey();
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
    const P = (id: string, title: string, href: string, icon: IconName, keywords = ""): PaletteItem => ({ id: "p:" + id, title, sub: "Page", group: "Pages", icon, href, keywords });
    const isGuest = !!user?.isGuest;
    const pages: PaletteItem[] = user
      ? [
          P("home", "Home", ROUTES.dashboard, "home", "chief of staff dashboard briefing overview start"),
          P("objectives", "Objectives", ROUTES.objectives, "target", "outcomes work history results executions"),
          P("team", "AI Team", ROUTES.aiTeam, "org", "executives specialists capabilities organization chart"),
          P("context", "Company Context", ROUTES.context, "building", "company profile documents website memory knowledge"),
          P("reports", "Reports", ROUTES.reports, "report", "completed outcomes deliverables evidence earlier reports shared"),
          P("approvals", "Approvals", ROUTES.approvals, "shield", "approve plan budget authorize"),
          P("exceptions", "Exceptions", ROUTES.exceptions, "alert", "blocked attention problems missing information"),
          P("usage", "Usage", ROUTES.usage, "wallet", "billing spend balance payments transactions budget refund"),
          P("routines", "Recurring objectives", ROUTES.routines, "redo", "routines recurring schedule weekly monthly"),
          ...(isGuest
            ? []
            : [
                P("members", "Organization members", ROUTES.members, "users", "team invite colleagues organization"),
                P("settings", "Settings", ROUTES.settings, "settings", "profile account password email verification autonomy approval threshold"),
              ]),
          ...(user.isAdmin ? [P("admin", "Operations", ROUTES.admin, "chart", "admin operations health")] : []),
          P("how", "How it works", ROUTES.howItWorksPage, "layers", "explanation loop chief of staff verification"),
          P("privacy", "Privacy Policy", ROUTES.privacy, "lock", "legal gdpr data"),
          P("terms", "Terms of Use", ROUTES.terms, "file", "legal conditions"),
        ]
      : [
          P("home", "Home", ROUTES.home, "home", "landing start"),
          P("how", "How it works", ROUTES.howItWorksPage, "layers", "explanation loop chief of staff verification"),
          P("privacy", "Privacy Policy", ROUTES.privacy, "lock", "legal gdpr data"),
          P("terms", "Terms of Use", ROUTES.terms, "file", "legal conditions"),
        ];
    const A = (id: string, title: string, icon: IconName, run: () => void, keywords = ""): PaletteItem => ({ id: "a:" + id, title, sub: "Action", group: "Actions", icon, run, keywords });
    const actions: PaletteItem[] = [
      ...(user ? [{ ...A("new", "Define an outcome", "plus", () => router.push(ROUTES.newObjective), "new objective create start delegate"), href: ROUTES.newObjective }] : []),
      A("theme", resolved === "dark" ? "Switch to light theme" : "Switch to dark theme", resolved === "dark" ? "sun" : "moon", toggle, "theme dark light appearance mode"),
      ...(theme !== "system" ? [A("system", "Match the system theme", "monitor", () => setTheme("system"), "theme system automatic os appearance")] : []),
      A("keys", "Keyboard shortcuts", "keyboard", onShortcuts, "help keys hotkeys"),
      isGuest
        ? { ...A("save", "Save your work", "userPlus", () => router.push(`${ROUTES.signup}?claim=1`), "create account sign up keep trial"), href: `${ROUTES.signup}?claim=1` }
        : user
          ? A("out", "Sign out", "out", () => {
              signOut();
              router.push(ROUTES.home);
            }, "log out logout")
          : A("in", "Log in", "user", () => router.push(ROUTES.login), "sign in"),
      ...(!user ? [{ ...A("join", "Get started", "userPlus", () => router.push(ROUTES.signup), "sign up register create account"), href: ROUTES.signup }] : []),
      ...(emailOn && !user ? [{ ...A("forgot", "Forgot password", "lock", () => router.push(ROUTES.forgotPassword), "reset password"), href: ROUTES.forgotPassword }] : []),
    ];
    const objs: PaletteItem[] = objectives.map((o) => ({
      id: "o:" + o.id,
      title: o.title,
      sub: statusLabel(o.status),
      group: "Objectives",
      icon: "target",
      href: ROUTES.objective(o.id),
      keywords: o.statement.slice(0, 300),
    }));
    return [...pages, ...actions, ...objs];
  }, [user, objectives, theme, resolved, toggle, setTheme, router, signOut, onShortcuts, emailOn]);

  const searching = !!q.trim();
  const results = useMemo(() => {
    if (!searching) {
      // No query: pages + actions, then the latest objectives.
      return items.filter((i) => i.group !== "Objectives").concat(items.filter((i) => i.group === "Objectives").slice(0, 5));
    }
    return items
      .map((it) => {
        // Best field wins; title beats keywords beats the "Page/Action" label.
        const fields: [string, number][] = [
          [it.title, 0],
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
  }, [items, q, searching]);

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

  // Group consecutive results (only when browsing; search results are ranked, so one flat group).
  const groups: { name: string; rows: { it: PaletteItem; i: number }[] }[] = [];
  results.forEach((it, i) => {
    const name = searching ? "Results" : it.group;
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.rows.push({ it, i });
    else groups.push({ name, rows: [{ it, i }] });
  });

  const row = ({ it, i }: { it: PaletteItem; i: number }) => {
    const sub = it.group === "Objectives" ? (searching ? `Objective · ${it.sub}` : it.sub) : searching ? it.sub : null;
    return (
      <div
        key={it.id}
        id={`${lid}-${i}`}
        data-i={i}
        role="option"
        aria-selected={i === sel}
        className="mrow"
        onMouseMove={() => i !== sel && setSel(i)}
        onClick={() => choose(it)}
      >
        <span className="lead">
          <span className="sh-pico" aria-hidden="true">
            <Icon name={it.icon} />
          </span>
          <b>{it.title}</b>
        </span>
        {sub && <span className="sh-psub">{sub}</span>}
      </div>
    );
  };

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
          aria-expanded={results.length > 0}
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
          groups.map((g, gi) =>
            searching ? (
              <Fragment key={g.name + gi}>{g.rows.map(row)}</Fragment>
            ) : (
              <div key={g.name + gi} role="group" aria-labelledby={`${lid}-g${gi}`}>
                <div className="pgrp" id={`${lid}-g${gi}`} role="presentation">
                  {g.name === "Objectives" ? "Recent objectives" : g.name}
                </div>
                {g.rows.map(row)}
              </div>
            )
          )
        ) : (
          <p className="sh-pempty">No matches. Try an objective, a page or an action.</p>
        )}
      </div>
      <div className="sh-pfoot" aria-hidden="true">
        <span className="sh-pf-nav">
          <kbd className="kbd">↑</kbd>
          <kbd className="kbd">↓</kbd> to move
        </span>
        <span>
          <kbd className="kbd">Enter</kbd> to open
        </span>
        <span>
          <kbd className="kbd">Esc</kbd> to close
        </span>
        <span style={{ marginLeft: "auto" }}>
          <kbd className="kbd">{mod}</kbd>
          <kbd className="kbd">K</kbd> anywhere
        </span>
      </div>
    </Modal>
  );
}

export default CommandPalette;
