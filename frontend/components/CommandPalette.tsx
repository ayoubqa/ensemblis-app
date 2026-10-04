"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api, type Agent } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ROUTES } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import { fuzzyScore } from "@/lib/utils";
import { Icon, type IconName } from "./Icon";
import { Modal } from "./Modal";

export interface PaletteItem {
  id: string;
  title: string;
  sub: string;
  group: "Pages" | "Actions" | "Agents";
  icon: IconName;
  href?: string;
  run?: () => void;
  keywords?: string;
}

let agentCache: Agent[] | null = null;
let agentPromise: Promise<Agent[]> | null = null;
function loadAgents(): Promise<Agent[]> {
  if (agentCache) return Promise.resolve(agentCache);
  if (!agentPromise) {
    agentPromise = api
      .listAgents()
      .then((r) => (agentCache = r.agents))
      .catch(() => {
        agentPromise = null;
        return [];
      });
  }
  return agentPromise;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onShortcuts: () => void;
  onGetStarted: () => void;
}

/**
 * ⌘K palette: fuzzy search over pages, actions and (lazily fetched) agents.
 * ↑/↓ to move, Enter to go, Esc to close. Opened by ShellProvider.
 */
export function CommandPalette({ open, onClose, onShortcuts, onGetStarted }: CommandPaletteProps) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { toggle, resolved } = useTheme();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [agents, setAgents] = useState<Agent[]>(agentCache || []);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lid = useId();

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    loadAgents().then(setAgents);
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const P = (id: string, title: string, href: string, icon: IconName, keywords = ""): PaletteItem => ({ id: "p:" + id, title: "Go to " + title, sub: "Page", group: "Pages", icon, href, keywords });
    const pages: PaletteItem[] = user
      ? [
          P("dash", "Dashboard", ROUTES.dashboard, "home", "home work overview"),
          P("tasks", "My work", ROUTES.tasks, "list", "task history tasks results"),
          P("workflows", "Workflows", ROUTES.workflows, "redo", "recurring schedule automation"),
          P("workforce", "My Workforce", ROUTES.workforce, "user", "saved agents team"),
          P("billing", "Billing", ROUTES.billing, "eur", "payments credits top up wallet"),
          P("settings", "Settings", ROUTES.settings, "settings", "profile account password"),
          P("agents", "Agents", ROUTES.agents, "compass", "explore marketplace browse"),
          ...(user.accountType === "DEVELOPER"
            ? [P("devdash", "Developer dashboard", ROUTES.devDashboard, "chart", "revenue my agents analytics"), P("publish", "Publish an agent", ROUTES.publish, "plus", "new agent create")]
            : []),
          P("dev", "Developers", ROUTES.developers, "code", "build publish"),
          P("network", "Network", ROUTES.network, "globe", "resources economy"),
          P("pricing", "Pricing", ROUTES.pricing, "eur", "plans"),
          P("changelog", "Changelog", ROUTES.changelog, "list", "updates what's new"),
          P("privacy", "Privacy Policy", ROUTES.privacy, "lock", "legal gdpr data protection personal data"),
          P("terms", "Terms of Use", ROUTES.terms, "file", "legal conditions acceptable use"),
        ]
      : [
          P("home", "Home", ROUTES.home, "home"),
          P("agents", "Agents", ROUTES.agents, "compass", "explore marketplace browse"),
          P("dev", "Developers", ROUTES.developers, "code", "build publish"),
          P("how", "How it works", ROUTES.howItWorks, "layers"),
          P("network", "Resources", ROUTES.network, "globe", "network economy"),
          P("pricing", "Pricing", ROUTES.pricing, "eur", "plans"),
          P("changelog", "Changelog", ROUTES.changelog, "list", "updates what's new"),
          P("privacy", "Privacy Policy", ROUTES.privacy, "lock", "legal gdpr data protection personal data"),
          P("terms", "Terms of Use", ROUTES.terms, "file", "legal conditions acceptable use"),
        ];
    const A = (id: string, title: string, icon: IconName, run: () => void, keywords = ""): PaletteItem => ({ id: "a:" + id, title, sub: "Action", group: "Actions", icon, run, keywords });
    const actions: PaletteItem[] = [
      { ...A("new", "Start a new task", "plus", () => router.push(ROUTES.newTask), "create describe work"), href: ROUTES.newTask },
      A("theme", resolved === "dark" ? "Switch to light mode" : "Switch to dark mode", resolved === "dark" ? "sun" : "moon", toggle, "theme dark light appearance"),
      A("keys", "Keyboard shortcuts", "keyboard", onShortcuts, "help keys"),
      user
        ? A("out", "Sign out", "out", () => {
            signOut();
            router.push(ROUTES.home);
          }, "log out logout")
        : A("in", "Log in", "user", () => router.push(ROUTES.login), "sign in"),
      ...(!user ? [A("join", "Get started", "spark", onGetStarted, "sign up register create account")] : []),
    ];
    const ags: PaletteItem[] = agents.map((a) => ({
      id: "g:" + a.id,
      title: a.name,
      sub: "Agent · " + a.category,
      group: "Agents",
      icon: "spark",
      href: ROUTES.agent(a.slug),
      keywords: `${a.creator} ${a.capabilities.join(" ")} ${a.taskType}`,
    }));
    return [...pages, ...actions, ...ags];
  }, [user, agents, resolved, toggle, router, signOut, onShortcuts, onGetStarted]);

  const results = useMemo(() => {
    if (!q.trim()) {
      // No query: pages + actions, then a few agents.
      return items.filter((i) => i.group !== "Agents").concat(items.filter((i) => i.group === "Agents").slice(0, 4));
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
          placeholder="Jump to a page, agent, or action…"
          role="combobox"
          aria-expanded="true"
          aria-controls={lid}
          aria-activedescendant={results[sel] ? `${lid}-${sel}` : undefined}
          aria-autocomplete="list"
          aria-label="Search pages, agents and actions"
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
            No matches. Try an agent name, a page or an action.
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
