"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, KeyboardEvent as ReactKeyboardEvent } from "react";
import { api, type Task } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { eur, relativeTime } from "@/lib/format";
import { useMediaQuery, useOnClickOutside, usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { storage } from "@/lib/utils";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Logo } from "./Logo";
import { Modal } from "./Modal";
import { useShell } from "./Shell";
import { ThemeSwitch } from "./ThemeSwitch";
import { useToast } from "./Toast";

// ------------------------------------------------------------------ nav model
type NavItem = { href: string; label: string; match: (p: string) => boolean };
const starts = (p: string, ...prefixes: string[]) => prefixes.some((x) => p === x || p.startsWith(x + "/"));

export const PUBLIC_NAV: NavItem[] = [
  {
    href: ROUTES.newTask,
    label: "Work",
    match: (p) => starts(p, "/new", "/tasks"),
  },
  { href: ROUTES.agents, label: "Agents", match: (p) => starts(p, "/agents") },
  {
    href: ROUTES.developers,
    label: "Developers",
    match: (p) => starts(p, "/developers", "/economics"),
  },
  { href: ROUTES.howItWorks, label: "How it works", match: () => false },
  {
    href: ROUTES.network,
    label: "Resources",
    match: (p) => starts(p, "/network", "/changelog", "/pricing", "/brand"),
  },
];
export const SIGNED_NAV: NavItem[] = [
  {
    href: ROUTES.dashboard,
    label: "Dashboard",
    match: (p) => p === "/dashboard" || starts(p, "/billing", "/settings", "/team", "/admin"),
  },
  {
    href: ROUTES.tasks,
    label: "My work",
    match: (p) => starts(p, "/tasks", "/new", "/workflows"),
  },
  {
    href: ROUTES.agents,
    label: "Agents",
    match: (p) => starts(p, "/agents", "/workforce"),
  },
  {
    href: ROUTES.developers,
    label: "Developers",
    match: (p) => starts(p, "/developers", "/economics", "/dashboard/developer"),
  },
  {
    href: ROUTES.network,
    label: "Network",
    match: (p) => starts(p, "/network", "/changelog", "/pricing", "/brand"),
  },
];

// ------------------------------------------------------------------ notifications
export interface Notification {
  id: string;
  taskId: string;
  kind: "ok" | "bad" | "info";
  bold: string;
  rest: string;
  sub: string;
  at: number;
}

const SEEN_KEY = (uid: string) => `ensemblis_notif_seen_${uid}`;

function deriveNotifications(tasks: Task[]): Notification[] {
  const out: Notification[] = [];
  for (const t of tasks) {
    const at = new Date(t.completedAt || t.startedAt || t.createdAt).getTime();
    if (t.status === "COMPLETED")
      out.push({
        id: t.id + ":c",
        taskId: t.id,
        kind: "ok",
        bold: t.title,
        rest: " is ready",
        sub: `${relativeTime(t.completedAt || t.createdAt)} · ${eur(t.costCents)}`,
        at,
      });
    else if (t.status === "FAILED")
      out.push({
        id: t.id + ":f",
        taskId: t.id,
        kind: "bad",
        bold: t.title,
        rest: " did not complete",
        sub: `${relativeTime(t.completedAt || t.createdAt)} · action needed`,
        at,
      });
    else if (t.status === "REFUNDED")
      out.push({
        id: t.id + ":r",
        taskId: t.id,
        kind: "info",
        bold: t.title,
        rest: ` was refunded (${eur(t.costCents)})`,
        sub: relativeTime(t.completedAt || t.createdAt),
        at,
      });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 8);
}

/** Notifications derived from the signed-in user's tasks (polled every 30s). */
export function useNotifications(enabled: boolean, userId?: string) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [seenAt, setSeenAt] = useState<number>(0);

  useEffect(() => {
    if (!userId) return;
    const raw = storage.get(SEEN_KEY(userId));
    if (raw) setSeenAt(Number(raw) || 0);
    else {
      const now = Date.now();
      storage.set(SEEN_KEY(userId), String(now));
      setSeenAt(now);
    }
  }, [userId]);

  const load = useCallback(async () => {
    const r = await api.listTasks();
    setTasks(r.tasks);
  }, []);
  usePolling(load, 30000, { enabled });

  const items = useMemo(() => deriveNotifications(tasks || []), [tasks]);
  const running = useMemo(() => (tasks || []).filter((t) => t.status === "RUNNING" || t.status === "PLANNING"), [tasks]);
  const unread = items.filter((n) => n.at > seenAt).length;
  const markRead = useCallback(() => {
    const now = Date.now();
    if (userId) storage.set(SEEN_KEY(userId), String(now));
    setSeenAt(now);
  }, [userId]);
  return {
    items,
    running,
    unread,
    seenAt,
    markRead,
    reload: load,
    loaded: tasks !== null,
  };
}

// ------------------------------------------------------------------ menu helpers
function focusItem(container: HTMLElement | null, dir: 1 | -1 | "first" | "last") {
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const n = dir === "first" ? 0 : dir === "last" ? items.length - 1 : (i + dir + items.length) % items.length;
  items[n].focus();
}
function menuKeys(e: ReactKeyboardEvent<HTMLElement>, el: HTMLElement | null, close: () => void) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    focusItem(el, 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    focusItem(el, -1);
  } else if (e.key === "Home") {
    e.preventDefault();
    focusItem(el, "first");
  } else if (e.key === "End") {
    e.preventDefault();
    focusItem(el, "last");
  } else if (e.key === "Escape") {
    e.preventDefault();
    close();
  } else if (e.key === "Tab") close();
}

function MenuLink({
  href,
  icon,
  children,
  onSelect,
  right,
  style,
}: {
  href: string;
  icon: IconName;
  children: React.ReactNode;
  onSelect: () => void;
  right?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <Link href={href} role="menuitem" onClick={onSelect} style={style}>
      <Icon name={icon} />
      {children}
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </Link>
  );
}

/** Where a guest goes to turn the trial into a real account (keeps their work). */
export const CLAIM_HREF = `${ROUTES.signup}?claim=1`;

/** Tiny "TEAM" marker shown next to a balance that is the shared team wallet. */
function TeamMark() {
  return (
    <span
      aria-hidden="true"
      style={{
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        padding: "1px 6px",
        borderRadius: 999,
        background: "var(--accent)",
        color: "var(--accent-ink)",
        lineHeight: 1.5,
      }}
    >
      team
    </span>
  );
}

// ------------------------------------------------------------------ Header
/**
 * Sticky blurred app header (prototype `header()`, `header.top.dk`). Public vs
 * signed-in nav, ⌘K search, notifications, credits pill and account menu.
 */
export function Header() {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname() || "/";
  const router = useRouter();
  const shell = useShell();
  const toast = useToast();
  const [menu, setMenu] = useState<null | "n" | "p">(null);
  const nRef = useRef<HTMLDivElement>(null);
  const pRef = useRef<HTMLDivElement>(null);
  const nMenu = useRef<HTMLDivElement>(null);
  const pMenu = useRef<HTMLDivElement>(null);
  const notif = useNotifications(!!user, user?.id);
  const [seenSnapshot, setSeenSnapshot] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const phone = useMediaQuery("(max-width: 560px)");
  const isGuest = !!user?.isGuest;
  const teamWallet = !!user && user.walletOwner === "team";
  const walletTitle = !user
    ? ""
    : teamWallet
      ? `Team wallet — ${user.team?.name ?? "your team"}`
      : isGuest
        ? "Trial credits — save your work to keep going"
        : "Credit balance — top up in Billing";

  const close = useCallback(() => setMenu(null), []);
  useOnClickOutside([nRef, pRef], close, menu !== null);
  useEffect(() => setMenu(null), [pathname]);

  const openMenu = (m: "n" | "p", viaKeyboard = false) => {
    if (menu === m) return setMenu(null);
    if (m === "n") {
      setSeenSnapshot(notif.seenAt);
      notif.markRead();
      notif.reload().catch(() => {});
    }
    setMenu(m);
    if (viaKeyboard) requestAnimationFrame(() => focusItem(m === "n" ? nMenu.current : pMenu.current, "first"));
  };

  // Guests carry a wider right-hand cluster ("Save your work"); keep their nav to the essentials so nothing overlaps.
  const nav = user ? (isGuest ? SIGNED_NAV.slice(0, 3) : SIGNED_NAV) : PUBLIC_NAV;

  const doSignOut = () => {
    setMenu(null);
    setConfirmExit(false);
    signOut();
    toast(isGuest ? "Guest session ended" : "Signed out");
    router.push(ROUTES.home);
  };

  return (
    <header className="top dk no-print">
      <div className="wrap in">
        <Logo />
        <nav className="main" aria-label="Main">
          {nav.map((n) => {
            const on = n.match(pathname);
            return (
              <Link key={n.label} href={n.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className={isGuest ? "hdr-r crowded guest" : teamWallet ? "hdr-r crowded" : "hdr-r"}>
          <button
            type="button"
            className="ibtn"
            onClick={shell.openPalette}
            aria-label="Search or jump to anything"
            title="Search or jump to anything (⌘K)"
            aria-keyshortcuts="Meta+K Control+K /"
            data-hdr-search
          >
            <Icon name="search" />
          </button>

          {loading ? (
            <div
              className="sk"
              style={{
                width: 120,
                height: 30,
                borderRadius: 999,
                opacity: 0.5,
              }}
              aria-hidden="true"
            />
          ) : user ? (
            <>
              <Link href={ROUTES.newTask} className={isGuest ? "btn sm hdr-new hideS" : "btn p sm hdr-new hideS"} aria-label="New task" aria-keyshortcuts="N">
                <Icon name="plus" />
                <span className="lbl">New task</span>
              </Link>
              <Link
                href={ROUTES.billing}
                className="credpill hideS"
                title={walletTitle}
                aria-label={`Credit balance ${eur(user.credits)}${teamWallet ? ` — team wallet${user.team ? `, ${user.team.name}` : ""}` : isGuest ? " — trial credits" : ""}`}
              >
                <Icon name="eur" size={14} />
                {eur(user.credits)}
                {teamWallet && <TeamMark />}
              </Link>

              {isGuest && (
                <>
                  <span className="tag warn hdr-guest-tag" title="You're trying Ensemblis without an account. Save your work to keep it.">
                    <Icon name="user" />
                    Guest
                  </span>
                  <Link href={CLAIM_HREF} className="btn p sm" title="Create a free account and keep everything you've done as a guest">
                    {phone ? "Save work" : "Save your work"}
                  </Link>
                </>
              )}

              {/* Notifications (guests on phones: hidden to make room for "Save work") */}
              <div className={isGuest ? "rel hideS" : "rel"} ref={nRef}>
                <button
                  type="button"
                  className="ibtn"
                  aria-label={notif.unread ? `Notifications (${notif.unread} new)` : "Notifications"}
                  aria-haspopup="menu"
                  aria-expanded={menu === "n"}
                  onClick={(e) => openMenu("n", e.detail === 0)}
                >
                  <Icon name="bell" />
                  {notif.unread > 0 && <span className="dot" aria-hidden="true" />}
                </button>
                {menu === "n" && (
                  <div
                    className="menu"
                    style={{ minWidth: 320, maxWidth: "calc(100vw - 24px)" }}
                    role="menu"
                    aria-label="Notifications"
                    ref={nMenu}
                    onKeyDown={(e) => menuKeys(e, nMenu.current, close)}
                  >
                    <div className="mh row between">
                      <span>Notifications</span>
                      <Link
                        href={ROUTES.tasks}
                        onClick={close}
                        className="tiny"
                        style={{
                          color: "var(--accent)",
                          padding: 0,
                          width: "auto",
                        }}
                      >
                        View all work
                      </Link>
                    </div>
                    {notif.running.slice(0, 2).map((t) => (
                      <Link key={t.id} href={ROUTES.task(t.id)} role="menuitem" className="notif-item" onClick={close}>
                        <span className="pulse" style={{ marginTop: 6, flex: "none" }} aria-hidden="true" />
                        <span>
                          <b>{t.title}</b> is in progress
                          <br />
                          <span className="tiny muted">Started {relativeTime(t.startedAt || t.createdAt)}</span>
                        </span>
                      </Link>
                    ))}
                    {notif.items.map((n) => (
                      <Link key={n.id} href={ROUTES.task(n.taskId)} role="menuitem" className="notif-item" onClick={close}>
                        <span className={`nd ${n.kind === "bad" ? "bad" : n.at > seenSnapshot ? "new" : ""}`} aria-hidden="true" />
                        <span>
                          <b>{n.bold}</b>
                          {n.rest}
                          <br />
                          <span className="tiny muted">{n.sub}</span>
                        </span>
                      </Link>
                    ))}
                    {!notif.items.length && !notif.running.length && (
                      <p className="small muted" style={{ padding: "10px 10px 12px" }}>
                        {notif.loaded ? "No notifications yet. Finished and failed tasks will show up here." : "Loading…"}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Account */}
              <div className="rel" ref={pRef}>
                <button
                  type="button"
                  className="pf"
                  aria-haspopup="menu"
                  aria-expanded={menu === "p"}
                  aria-label="Account menu"
                  onClick={(e) => openMenu("p", e.detail === 0)}
                >
                  <Avatar name={user.name} hue={250} round />
                  <span className="nm">{user.name}</span>
                </button>
                {menu === "p" && (
                  <div
                    className="menu"
                    role="menu"
                    aria-label="Account"
                    ref={pMenu}
                    onKeyDown={(e) => menuKeys(e, pMenu.current, close)}
                    style={{ minWidth: 270 }}
                  >
                    <div className="mi">
                      <Avatar name={isGuest ? "Guest" : user.name} hue={250} round style={{ width: 36, height: 36 }} />
                      <div style={{ minWidth: 0 }}>
                        <b>{isGuest ? "Guest session" : user.name}</b>
                        <div
                          className="tiny muted"
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {isGuest
                            ? `${eur(user.credits)} trial credits · not saved yet`
                            : user.team
                              ? `${user.team.name} · ${user.team.role === "OWNER" ? "Team owner" : "Team member"}`
                              : [user.company, user.role].filter(Boolean).join(" · ") || user.email}
                        </div>
                      </div>
                    </div>
                    <hr />
                    {isGuest ? (
                      <>
                        <MenuLink href={CLAIM_HREF} icon="check" onSelect={close} style={{ color: "var(--accent)", fontWeight: 700 }}>
                          Save your work
                        </MenuLink>
                        <p className="tiny muted" style={{ padding: "0 10px 6px 36px", margin: 0, maxWidth: 260 }}>
                          Create a free account to keep your tasks and unlock workflows, teams and more.
                        </p>
                        <MenuLink href={ROUTES.tasks} icon="list" onSelect={close}>
                          My work
                        </MenuLink>
                        <MenuLink href={ROUTES.examples} icon="file" onSelect={close}>
                          Examples
                        </MenuLink>
                      </>
                    ) : (
                      <>
                        <MenuLink href={ROUTES.profile} icon="user" onSelect={close}>
                          Profile
                        </MenuLink>
                        <MenuLink href={ROUTES.settings} icon="settings" onSelect={close}>
                          Settings
                        </MenuLink>
                        <MenuLink
                          href={ROUTES.billing}
                          icon="eur"
                          onSelect={close}
                          right={
                            <span className="tiny muted row" style={{ gap: 6 }} title={walletTitle}>
                              {eur(user.credits)}
                              {teamWallet && <TeamMark />}
                            </span>
                          }
                        >
                          Billing
                        </MenuLink>
                        <MenuLink
                          href={ROUTES.team}
                          icon="share"
                          onSelect={close}
                          right={
                            <span className="tiny muted" style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                              {user.team ? user.team.name : "Invite people"}
                            </span>
                          }
                        >
                          Team
                        </MenuLink>
                        <MenuLink href={ROUTES.workflows} icon="redo" onSelect={close}>
                          Workflows
                        </MenuLink>
                        <MenuLink href={ROUTES.workforce} icon="layers" onSelect={close}>
                          My Workforce
                        </MenuLink>
                        <MenuLink href={ROUTES.examples} icon="file" onSelect={close}>
                          Examples
                        </MenuLink>
                        {user.accountType === "DEVELOPER" && (
                          <MenuLink href={ROUTES.devDashboard} icon="code" onSelect={close}>
                            Developer dashboard
                          </MenuLink>
                        )}
                        {user.isAdmin && (
                          <MenuLink href={ROUTES.admin} icon="chart" onSelect={close}>
                            Owner dashboard
                          </MenuLink>
                        )}
                      </>
                    )}
                    <hr />
                    <div className="mi-row">
                      <span>Theme</span>
                      <ThemeSwitch iconsOnly />
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        shell.openShortcuts();
                      }}
                    >
                      <Icon name="keyboard" />
                      Keyboard shortcuts
                      <kbd className="kbd">?</kbd>
                    </button>
                    <hr />
                    {isGuest ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          setConfirmExit(true);
                        }}
                      >
                        <Icon name="out" />
                        End guest session
                      </button>
                    ) : (
                      <button type="button" role="menuitem" onClick={doSignOut}>
                        <Icon name="out" />
                        Sign out
                      </button>
                    )}
                  </div>
                )}
              </div>

              <Modal open={confirmExit} onClose={() => setConfirmExit(false)} title="End your guest session?">
                <p className="muted small" style={{ margin: "6px 0 16px" }}>
                  Guest work isn&apos;t saved to an account. If you end the session now, you won&apos;t be able to get back to your tasks or
                  results. Create a free account first to keep them.
                </p>
                <div className="row wrapflex">
                  <Link href={CLAIM_HREF} className="btn p" onClick={() => setConfirmExit(false)} data-autofocus>
                    Save your work
                  </Link>
                  <button type="button" className="btn bad" onClick={doSignOut}>
                    End session
                  </button>
                </div>
              </Modal>
            </>
          ) : (
            <>
              <Link href={ROUTES.login} className="btn sm hideM" style={{ background: "transparent" }}>
                Log in
              </Link>
              <button type="button" className="btn p sm" onClick={() => shell.openRoleSelect()}>
                Get started
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ BottomNav
/** Mobile bottom tab bar (`.bottom`, visible below 860px). */
export function BottomNav() {
  const { user } = useAuth();
  const pathname = usePathname() || "/";
  const shell = useShell();
  const items: {
    href?: string;
    label: string;
    icon: IconName;
    on: boolean;
    onClick?: () => void;
  }[] = user
    ? [
        {
          href: ROUTES.dashboard,
          label: "Work",
          icon: "home",
          on: pathname === "/dashboard" || starts(pathname, "/tasks"),
        },
        {
          href: ROUTES.agents,
          label: "Agents",
          icon: "compass",
          on: starts(pathname, "/agents"),
        },
        {
          href: ROUTES.newTask,
          label: "New",
          icon: "plus",
          on: starts(pathname, "/new"),
        },
        // Guests can't use workflows or settings yet: show examples + the "save your work" path instead.
        user.isGuest
          ? { href: ROUTES.examples, label: "Examples", icon: "file", on: starts(pathname, "/examples") }
          : {
              href: ROUTES.workflows,
              label: "Flows",
              icon: "layers",
              on: starts(pathname, "/workflows"),
            },
        user.isGuest
          ? { href: CLAIM_HREF, label: "Save", icon: "check", on: starts(pathname, "/signup") }
          : {
              href: ROUTES.settings,
              label: "Profile",
              icon: "user",
              on: starts(pathname, "/settings", "/billing", "/workforce", "/team"),
            },
      ]
    : [
        {
          href: ROUTES.home,
          label: "Home",
          icon: "home",
          on: pathname === "/",
        },
        {
          href: ROUTES.agents,
          label: "Agents",
          icon: "compass",
          on: starts(pathname, "/agents"),
        },
        {
          href: ROUTES.newTask,
          label: "Start",
          icon: "plus",
          on: starts(pathname, "/new"),
        },
        { href: ROUTES.howItWorks, label: "How", icon: "layers", on: false },
        {
          label: "Log in",
          icon: "user",
          on: starts(pathname, "/login", "/signup"),
          onClick: () => shell.openRoleSelect(),
        },
      ];
  return (
    <nav className="bottom no-print" aria-label="Primary">
      {items.map((it) =>
        it.href ? (
          <Link key={it.label} href={it.href} className={it.on ? "on" : undefined} aria-current={it.on ? "page" : undefined}>
            <Icon name={it.icon} />
            {it.label}
          </Link>
        ) : (
          <button key={it.label} type="button" className={it.on ? "on" : undefined} onClick={it.onClick}>
            <Icon name={it.icon} />
            {it.label}
          </button>
        ),
      )}
    </nav>
  );
}

export default Header;
