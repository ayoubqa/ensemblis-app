"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, KeyboardEvent as ReactKeyboardEvent } from "react";
import { api, type Attention } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { eur } from "@/lib/format";
import { useMediaQuery, useOnClickOutside, usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Logo } from "./Logo";
import { Modal } from "./Modal";
import { useShell } from "./Shell";
import { ThemeSwitch } from "./ThemeSwitch";
import { useToast } from "./Toast";

// ------------------------------------------------------------------ nav model
type NavItem = { href: string; label: string; match: (p: string) => boolean; badge?: keyof Attention };
const starts = (p: string, ...prefixes: string[]) => prefixes.some((x) => p === x || p.startsWith(x + "/"));

export const PUBLIC_NAV: NavItem[] = [{ href: ROUTES.howItWorks, label: "How it works", match: () => false }];

export const SIGNED_NAV: NavItem[] = [
  { href: ROUTES.dashboard, label: "Dashboard", match: (p) => p === "/dashboard" },
  { href: ROUTES.objectives, label: "Objectives", match: (p) => starts(p, "/objectives", "/tasks", "/routines") },
  { href: ROUTES.aiTeam, label: "AI Team", match: (p) => starts(p, "/ai-team") },
  { href: ROUTES.context, label: "Context", match: (p) => starts(p, "/context") },
  { href: ROUTES.approvals, label: "Approvals", match: (p) => starts(p, "/approvals"), badge: "approvals" },
  { href: ROUTES.exceptions, label: "Exceptions", match: (p) => starts(p, "/exceptions"), badge: "exceptions" },
  { href: ROUTES.usage, label: "Usage", match: (p) => starts(p, "/usage", "/billing") },
];

/** Pending approvals / open exceptions / running executions for the badges (polled every 60s, paused in hidden tabs). */
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

/** Call after approving / resolving something so header badges update immediately. */
export function refreshAttention() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("ensemblis:attention"));
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
  } else if (e.key === "Escape") {
    e.preventDefault();
    close();
  } else if (e.key === "Tab") close();
}

function MenuLink({ href, icon, children, onSelect, right }: { href: string; icon: IconName; children: React.ReactNode; onSelect: () => void; right?: React.ReactNode }) {
  return (
    <Link href={href} role="menuitem" onClick={onSelect}>
      <Icon name={icon} />
      {children}
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </Link>
  );
}

/** Where a guest goes to turn the trial into a real account (keeps their work). */
export const CLAIM_HREF = `${ROUTES.signup}?claim=1`;

function Badge({ n, tone }: { n: number; tone: "warn" | "bad" }) {
  if (!n) return null;
  return (
    <span className={`navbadge ${tone}`} aria-label={`${n} pending`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

// ------------------------------------------------------------------ Header
export function Header() {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname() || "/";
  const router = useRouter();
  const shell = useShell();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const pRef = useRef<HTMLDivElement>(null);
  const pMenu = useRef<HTMLDivElement>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const phone = useMediaQuery("(max-width: 560px)");
  const isGuest = !!user?.isGuest;
  const attention = useAttention(!!user);

  const close = useCallback(() => setMenu(false), []);
  useOnClickOutside([pRef], close, menu);
  useEffect(() => setMenu(false), [pathname]);

  const doSignOut = () => {
    setMenu(false);
    setConfirmExit(false);
    signOut();
    toast(isGuest ? "Guest session ended" : "Signed out");
    router.push(ROUTES.home);
  };

  const nav = user ? SIGNED_NAV : PUBLIC_NAV;

  return (
    <header className="top dk no-print">
      <div className="wrap in wide">
        <Logo href={user ? ROUTES.dashboard : ROUTES.home} />
        <nav className="main" aria-label="Main">
          {nav.map((n) => {
            const on = n.match(pathname);
            const count = n.badge && attention ? attention[n.badge] : 0;
            return (
              <Link key={n.label} href={n.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                {n.label}
                {n.badge && <Badge n={count} tone={n.badge === "exceptions" ? "bad" : "warn"} />}
              </Link>
            );
          })}
        </nav>
        <div className="hdr-r">
          <button type="button" className="ibtn" onClick={shell.openPalette} aria-label="Search or jump to anything" title="Search or jump to anything (⌘K)" aria-keyshortcuts="Meta+K Control+K /">
            <Icon name="search" />
          </button>

          {loading ? (
            <div className="sk" style={{ width: 120, height: 30, borderRadius: 999, opacity: 0.5 }} aria-hidden="true" />
          ) : user ? (
            <>
              <Link href={ROUTES.newObjective} className="btn p sm hdr-new hideS" aria-keyshortcuts="N">
                <Icon name="plus" />
                <span className="lbl">Define an outcome</span>
              </Link>
              <Link
                href={ROUTES.usage}
                className="credpill hideS"
                title={user.walletOwner === "team" ? `Organization balance — ${user.team?.name ?? "your team"}` : "Balance available for executions"}
                aria-label={`Balance ${eur(user.credits)}`}
              >
                <Icon name="wallet" size={14} />
                {eur(user.credits)}
              </Link>
              {isGuest && (
                <Link href={CLAIM_HREF} className="btn sm" title="Create a free account and keep everything from your trial">
                  {phone ? "Save" : "Save your work"}
                </Link>
              )}
              <div className="rel" ref={pRef}>
                <button type="button" className="pf" aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu" onClick={(e) => {
                  setMenu((m) => !m);
                  if (e.detail === 0) requestAnimationFrame(() => focusItem(pMenu.current, "first"));
                }}>
                  <Avatar name={user.name} hue={220} round />
                  <span className="nm">{isGuest ? "Guest" : user.name}</span>
                </button>
                {menu && (
                  <div className="menu" role="menu" aria-label="Account" ref={pMenu} onKeyDown={(e) => menuKeys(e, pMenu.current, close)} style={{ minWidth: 270 }}>
                    <div className="mi">
                      <Avatar name={isGuest ? "Guest" : user.name} hue={220} round style={{ width: 36, height: 36 }} />
                      <div style={{ minWidth: 0 }}>
                        <b>{isGuest ? "Guest session" : user.name}</b>
                        <div className="tiny muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          {isGuest ? `${eur(user.credits)} trial balance · not saved yet` : user.team ? `${user.team.name} · ${user.team.role === "OWNER" ? "Owner" : "Member"}` : user.email}
                        </div>
                      </div>
                    </div>
                    <hr />
                    {isGuest && (
                      <MenuLink href={CLAIM_HREF} icon="check" onSelect={close}>
                        Save your work
                      </MenuLink>
                    )}
                    <MenuLink href={ROUTES.routines} icon="redo" onSelect={close}>
                      Recurring objectives
                    </MenuLink>
                    {!isGuest && (
                      <>
                        <MenuLink href={ROUTES.members} icon="share" onSelect={close} right={<span className="tiny muted">{user.team ? user.team.name : "Invite"}</span>}>
                          Organization members
                        </MenuLink>
                        <MenuLink href={ROUTES.settings} icon="settings" onSelect={close}>
                          Settings
                        </MenuLink>
                      </>
                    )}
                    {user.isAdmin && (
                      <MenuLink href={ROUTES.admin} icon="chart" onSelect={close}>
                        Operations (owner)
                      </MenuLink>
                    )}
                    <hr />
                    <div className="mi-row">
                      <span>Theme</span>
                      <ThemeSwitch iconsOnly />
                    </div>
                    <button type="button" role="menuitem" onClick={() => { close(); shell.openShortcuts(); }}>
                      <Icon name="keyboard" />
                      Keyboard shortcuts
                      <kbd className="kbd">?</kbd>
                    </button>
                    <hr />
                    <button type="button" role="menuitem" onClick={() => (isGuest ? (close(), setConfirmExit(true)) : doSignOut())}>
                      <Icon name="out" />
                      {isGuest ? "End guest session" : "Sign out"}
                    </button>
                  </div>
                )}
              </div>
              <Modal open={confirmExit} onClose={() => setConfirmExit(false)} title="End your guest session?">
                <p className="muted small" style={{ margin: "6px 0 16px" }}>
                  Guest work isn&apos;t saved to an account. Create a free account first to keep your objectives and outcomes.
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
              <Link href={ROUTES.signup} className="btn p sm">
                Get started
              </Link>
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
  const items: { href: string; label: string; icon: IconName; on: boolean }[] = user
    ? [
        { href: ROUTES.dashboard, label: "Briefing", icon: "home", on: pathname === "/dashboard" },
        { href: ROUTES.objectives, label: "Objectives", icon: "list", on: starts(pathname, "/objectives", "/tasks") },
        { href: ROUTES.newObjective, label: "New", icon: "plus", on: pathname === "/objectives/new" },
        { href: ROUTES.approvals, label: "Attention", icon: "flag", on: starts(pathname, "/approvals", "/exceptions") },
        { href: ROUTES.aiTeam, label: "AI Team", icon: "layers", on: starts(pathname, "/ai-team", "/context") },
      ]
    : [
        { href: ROUTES.home, label: "Home", icon: "home", on: pathname === "/" },
        { href: ROUTES.howItWorks, label: "How", icon: "layers", on: false },
        { href: ROUTES.signup, label: "Start", icon: "plus", on: starts(pathname, "/signup") },
        { href: ROUTES.login, label: "Log in", icon: "user", on: starts(pathname, "/login") },
      ];
  return (
    <nav className="bottom no-print" aria-label="Primary">
      {items.map((it) => (
        <Link key={it.label} href={it.href} className={it.on ? "on" : undefined} aria-current={it.on ? "page" : undefined}>
          <Icon name={it.icon} />
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export default Header;
