"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Attention } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { eur } from "@/lib/format";
import { useOnClickOutside } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Logo } from "./Logo";
import { Modal } from "./Modal";
import { refreshAttention, useAttention, useModKey, useShell } from "./Shell";
import { ThemeSwitch } from "./ThemeSwitch";
import { useToast } from "./Toast";

// The attention hook lives in Shell (one poll shared by the header and the mobile bar);
// re-exported here because pages import it from "./Header".
export { useAttention, refreshAttention };

// ------------------------------------------------------------------ nav model
export type NavItem = { href: string; label: string; icon: IconName; match: (p: string) => boolean; badge?: keyof Attention };
const starts = (p: string, ...prefixes: string[]) => prefixes.some((x) => p === x || p.startsWith(x + "/"));
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Signed out: the story, then Log in / Get started (right-hand side). */
export const PUBLIC_NAV: NavItem[] = [{ href: ROUTES.howItWorks, label: "How it works", icon: "layers", match: () => false }];

/** Signed in, primary navigation (desktop). */
export const SIGNED_NAV: NavItem[] = [
  { href: ROUTES.dashboard, label: "Home", icon: "home", match: (p) => p === ROUTES.dashboard },
  { href: ROUTES.objectives, label: "Objectives", icon: "target", match: (p) => starts(p, ROUTES.objectives, ROUTES.routines) },
  { href: ROUTES.aiTeam, label: "AI Team", icon: "org", match: (p) => starts(p, ROUTES.aiTeam) },
  { href: ROUTES.context, label: "Company Context", icon: "building", match: (p) => starts(p, ROUTES.context) },
  { href: ROUTES.reports, label: "Reports", icon: "report", match: (p) => starts(p, ROUTES.reports, "/tasks") },
];

/** Always-visible attention controls with live counts. */
export const ATTENTION_NAV: (NavItem & { badge: keyof Attention; tone: "warn" | "bad"; some: string; none: string })[] = [
  { href: ROUTES.approvals, label: "Approvals", icon: "shield", match: (p) => starts(p, ROUTES.approvals), badge: "approvals", tone: "warn", some: "waiting", none: "none waiting" },
  { href: ROUTES.exceptions, label: "Exceptions", icon: "alert", match: (p) => starts(p, ROUTES.exceptions), badge: "exceptions", tone: "bad", some: "open", none: "none open" },
];

/** Where a guest goes to turn the trial into a real account (keeps their work). */
export const CLAIM_HREF = `${ROUTES.signup}?claim=1`;

const capped = (n: number) => (n > 99 ? "99+" : String(n));

// ------------------------------------------------------------------ focus helpers
const FOCUSABLE = 'a[href], button:not([disabled]):not([tabindex="-1"])';
function moveFocus(container: HTMLElement | null, dir: 1 | -1 | "first" | "last") {
  if (!container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const n = dir === "first" ? 0 : dir === "last" ? items.length - 1 : i < 0 ? 0 : (i + dir + items.length) % items.length;
  items[n].focus();
}

function AcctLink({ href, icon, children, onSelect, right, current }: { href: string; icon: IconName; children: ReactNode; onSelect: () => void; right?: ReactNode; current?: boolean }) {
  return (
    <Link href={href} className="sh-acct-item" onClick={onSelect} aria-current={current ? "page" : undefined}>
      <Icon name={icon} />
      <span className="sh-acct-lbl">{children}</span>
      {right && <span className="sh-acct-meta">{right}</span>}
    </Link>
  );
}

// ------------------------------------------------------------------ Header
/** The navy command bar every page lives under (`.dk` whatever the theme). */
export function Header() {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname() || "/";
  const router = useRouter();
  const shell = useShell();
  const toast = useToast();
  const mod = useModKey();
  const isGuest = !!user?.isGuest;
  const attention = shell.attention;
  const [menu, setMenu] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const hdrRef = useRef<HTMLElement>(null);
  const acctRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Publish the real header height (--sh-header-h) so sticky banners sit exactly under it.
  useEffect(() => {
    const el = hdrRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--sh-header-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const close = useCallback(() => setMenu(false), []);
  const closeToTrigger = useCallback(() => {
    setMenu(false);
    triggerRef.current?.focus();
  }, []);
  useOnClickOutside([acctRef], close, menu);
  useEffect(() => setMenu(false), [pathname]);

  const doSignOut = () => {
    setMenu(false);
    setConfirmExit(false);
    signOut();
    toast(isGuest ? "Guest session ended" : "Signed out");
    router.push(ROUTES.home);
  };

  // Disclosure panel keyboard: ↑/↓/Home/End move between controls, Esc closes and returns
  // focus to the trigger, Tab moves through every control (theme switch included) and
  // leaving the panel closes it.
  const onAcctKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!menu) {
      if (e.key === "ArrowDown" && e.target === triggerRef.current) {
        e.preventDefault();
        setMenu(true);
        requestAnimationFrame(() => moveFocus(panelRef.current, "first"));
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeToTrigger();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      moveFocus(panelRef.current, e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "Home" ? "first" : "last");
    }
  };
  const onAcctBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (menu && next && !acctRef.current?.contains(next)) setMenu(false);
  };

  const onUsage = starts(pathname, ROUTES.usage, "/billing");
  const balanceTitle = user ? (user.walletOwner === "team" ? `Organization balance — ${user.team?.name ?? "your organization"}` : "Balance available for executions") : "";

  return (
    <header className="sh-top dk no-print" ref={hdrRef}>
      <div className="wrap sh-bar">
        <Logo href={user ? ROUTES.dashboard : ROUTES.home} />

        <nav className="sh-nav" aria-label="Main">
          <ul className="sh-links">
            {(user ? SIGNED_NAV : PUBLIC_NAV).map((n) => {
              const on = n.match(pathname);
              return (
                <li key={n.label}>
                  <Link href={n.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          {user && (
            <ul className="sh-attn-group" aria-label="Needs attention">
              {ATTENTION_NAV.map((n) => {
                const on = n.match(pathname);
                const count = attention ? attention[n.badge] : null;
                return (
                  <li key={n.label}>
                    <Link
                      href={n.href}
                      className={cx("sh-attn", n.tone, !!count && "has", on && "on")}
                      aria-current={on ? "page" : undefined}
                      title={count === null ? n.label : `${n.label}, ${count ? `${count} ${n.some}` : n.none}`}
                    >
                      <Icon name={n.icon} />
                      <span className="sh-attn-lbl">{n.label}</span>
                      {!!count && (
                        <span className="sh-count" aria-hidden="true">
                          {capped(count)}
                        </span>
                      )}
                      {count !== null && <span className="sr-only">, {count ? `${count} ${n.some}` : n.none}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div className={cx("sh-right", isGuest && "guest")}>
          <button
            type="button"
            className="sh-ibtn sh-search"
            onClick={shell.openPalette}
            aria-label="Search or jump to anything"
            title={`Search or jump to anything (${mod} K)`}
            aria-keyshortcuts={user ? "Meta+K Control+K /" : "Meta+K Control+K"}
          >
            <Icon name="search" />
          </button>

          {loading ? (
            <div className="sk sh-sk" aria-hidden="true" />
          ) : user ? (
            <>
              <Link href={ROUTES.newObjective} className="btn p sm sh-cta" aria-keyshortcuts={shell.singleKeys ? "N" : undefined} title="Define an outcome">
                <Icon name="plus" />
                <span className="sh-cta-lbl">Define an outcome</span>
              </Link>
              <Link
                href={ROUTES.usage}
                className={cx("sh-bal", isGuest && "guest", onUsage && "on")}
                title={balanceTitle}
                aria-current={onUsage ? "page" : undefined}
                aria-label={`Balance ${eur(user.credits)}, open Usage`}
              >
                <Icon name="wallet" size={15} />
                <span className="sh-bal-amt">{eur(user.credits)}</span>
              </Link>
              {isGuest && (
                <Link href={CLAIM_HREF} className="btn sm sh-save" title="Create a free account and keep everything from your trial">
                  <span className="sh-lg">Save your work</span>
                  <span className="sh-sm">
                    Save<span className="sr-only"> your work</span>
                  </span>
                </Link>
              )}

              <div className="sh-acct-wrap" ref={acctRef} onKeyDown={onAcctKey} onBlur={onAcctBlur}>
                <button
                  ref={triggerRef}
                  type="button"
                  className={cx("sh-acct-btn", menu && "open")}
                  aria-expanded={menu}
                  aria-controls={panelId}
                  aria-label="Account menu"
                  onClick={(e) => {
                    const opening = !menu;
                    setMenu(opening);
                    if (opening && e.detail === 0) requestAnimationFrame(() => moveFocus(panelRef.current, "first"));
                  }}
                >
                  <Avatar name={isGuest ? "Guest" : user.name} hue={220} round size="sm" />
                  <Icon name="down" size={14} className="sh-chev" />
                </button>
                {menu && (
                  <div className="sh-acct" id={panelId} ref={panelRef}>
                    <div className="sh-acct-id">
                      <Avatar name={isGuest ? "Guest" : user.name} hue={220} round />
                      <div>
                        <b>{isGuest ? "Guest session" : user.name}</b>
                        <span>{isGuest ? "Trial — not saved to an account yet" : user.team ? `${user.team.name} · ${user.team.role === "OWNER" ? "Owner" : "Member"}` : user.email}</span>
                      </div>
                    </div>

                    <Link href={ROUTES.usage} className="sh-acct-bal" onClick={close} aria-current={onUsage ? "page" : undefined}>
                      <span>
                        <span className="sh-acct-k">{isGuest ? "Trial balance" : user.walletOwner === "team" ? "Organization balance" : "Balance"}</span>
                        <b>{eur(user.credits)}</b>
                      </span>
                      <span className="sh-acct-go">
                        Usage
                        <Icon name="chev" size={14} />
                      </span>
                    </Link>

                    {isGuest && (
                      <Link href={CLAIM_HREF} className="btn p sm sh-acct-save" onClick={close}>
                        <Icon name="userPlus" />
                        Save your work
                      </Link>
                    )}

                    <div className="sh-acct-list">
                      <AcctLink href={ROUTES.routines} icon="redo" onSelect={close} current={starts(pathname, ROUTES.routines)}>
                        Recurring objectives
                      </AcctLink>
                      {!isGuest && (
                        <>
                          <AcctLink href={ROUTES.members} icon="users" onSelect={close} current={starts(pathname, ROUTES.members)} right={user.team ? user.team.name : "Invite"}>
                            Organization members
                          </AcctLink>
                          <AcctLink href={ROUTES.settings} icon="settings" onSelect={close} current={starts(pathname, ROUTES.settings)}>
                            Settings
                          </AcctLink>
                        </>
                      )}
                      {user.isAdmin && (
                        <AcctLink href={ROUTES.admin} icon="chart" onSelect={close} current={starts(pathname, ROUTES.admin)} right="Admin">
                          Operations
                        </AcctLink>
                      )}
                    </div>

                    <div className="sh-acct-row">
                      <span id={`${panelId}-theme`}>Theme</span>
                      <ThemeSwitch iconsOnly />
                    </div>

                    <div className="sh-acct-list">
                      <button
                        type="button"
                        className="sh-acct-item sh-kbd-only"
                        onClick={() => {
                          close();
                          shell.openShortcuts();
                        }}
                      >
                        <Icon name="keyboard" />
                        <span className="sh-acct-lbl">Keyboard shortcuts</span>
                        {shell.singleKeys && <kbd className="kbd">?</kbd>}
                      </button>
                      <button type="button" className="sh-acct-item" onClick={() => (isGuest ? (close(), setConfirmExit(true)) : doSignOut())}>
                        <Icon name="out" />
                        <span className="sh-acct-lbl">{isGuest ? "End guest session" : "Sign out"}</span>
                      </button>
                    </div>
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
              {/* The page already offers the action it is for: no "Log in" on /login, no "Get started" on /signup. */}
              {!starts(pathname, ROUTES.login) && (
                <Link href={ROUTES.login} className="btn ghost sm sh-login">
                  Log in
                </Link>
              )}
              {!starts(pathname, ROUTES.signup) && (
                <Link href={ROUTES.signup} className="btn p sm">
                  Get started
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ BottomNav
type Tab = { key: string; href?: string; label: ReactNode; icon: IconName; on: boolean; badge?: { n: number; tone: "warn" | "bad"; sr: string }; primary?: boolean };

/** Pages reached from the mobile "More" sheet (it highlights while you are on one). */
const MORE_PATHS = [ROUTES.aiTeam, ROUTES.context, ROUTES.reports, "/tasks", ROUTES.usage, "/billing", ROUTES.members, ROUTES.settings, ROUTES.admin];

/**
 * Mobile bottom bar (below 860px): Home · Objectives · Define · Attention · More.
 * "More" opens a sheet with every other page, so the whole product is reachable on a phone.
 */
export function BottomNav() {
  const { user } = useAuth();
  const pathname = usePathname() || "/";
  const { attention } = useShell();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [pathname]);

  if (!user) {
    const tabs: Tab[] = [
      { key: "home", href: ROUTES.home, label: "Home", icon: "home", on: pathname === ROUTES.home },
      { key: "how", href: ROUTES.howItWorks, label: "How it works", icon: "layers", on: false },
      { key: "start", href: ROUTES.signup, label: "Get started", icon: "arrow", on: starts(pathname, ROUTES.signup) },
      { key: "login", href: ROUTES.login, label: "Log in", icon: "user", on: starts(pathname, ROUTES.login) },
    ];
    return (
      <nav className="sh-bottom dk no-print" aria-label="Primary">
        {tabs.map((t) => (
          <BottomTab key={t.key} tab={t} />
        ))}
      </nav>
    );
  }

  const isGuest = user.isGuest;
  const a = attention?.approvals ?? 0;
  const x = attention?.exceptions ?? 0;
  const attnHref = a > 0 ? ROUTES.approvals : x > 0 ? ROUTES.exceptions : ROUTES.approvals;
  const onMore = MORE_PATHS.some((p) => starts(pathname, p));
  const tabs: Tab[] = [
    { key: "home", href: ROUTES.dashboard, label: "Home", icon: "home", on: pathname === ROUTES.dashboard },
    { key: "obj", href: ROUTES.objectives, label: "Objectives", icon: "target", on: starts(pathname, ROUTES.objectives, ROUTES.routines) && pathname !== ROUTES.newObjective },
    {
      key: "define",
      href: ROUTES.newObjective,
      label: (
        <>
          Define<span className="sr-only"> an outcome</span>
        </>
      ),
      icon: "plus",
      on: pathname === ROUTES.newObjective,
      primary: true,
    },
    {
      key: "attn",
      href: attnHref,
      label: "Attention",
      icon: "inbox",
      on: starts(pathname, ROUTES.approvals, ROUTES.exceptions),
      badge: a + x > 0 ? { n: a + x, tone: x > 0 ? "bad" : "warn", sr: `, ${a + x} need${a + x === 1 ? "s" : ""} attention` } : undefined,
    },
  ];

  const tile = (href: string, icon: IconName, label: string, meta?: ReactNode, tone?: "warn" | "bad") => {
    const on = starts(pathname, href);
    return (
      <li key={href}>
        <Link href={href} className={cx("sh-tile", on && "on")} aria-current={on ? "page" : undefined} onClick={() => setMore(false)}>
          <span className="sh-tile-ico">
            <Icon name={icon} />
          </span>
          <span className="sh-tile-txt">
            <b>{label}</b>
            {meta && <span className={cx("sh-tile-meta", tone)}>{meta}</span>}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <>
      <nav className="sh-bottom dk no-print" aria-label="Primary">
        {tabs.map((t) => (
          <BottomTab key={t.key} tab={t} />
        ))}
        <button type="button" className={cx("sh-tab", onMore && "on")} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
          <span className="sh-tab-ico">
            <Icon name="grid" />
          </span>
          <span className="sh-tab-lbl">More</span>
        </button>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title="More" sheet className="sh-more">
        <nav aria-label="More pages">
          {isGuest && (
            <Link href={CLAIM_HREF} className="btn p sh-more-save" onClick={() => setMore(false)}>
              <Icon name="userPlus" />
              Save your work — create a free account
            </Link>
          )}
          <h4 className="sh-more-h">Workspace</h4>
          <ul className="sh-tiles">
            {tile(ROUTES.aiTeam, "org", "AI Team")}
            {tile(ROUTES.context, "building", "Company Context")}
            {tile(ROUTES.reports, "report", "Reports")}
          </ul>
          <h4 className="sh-more-h">Attention</h4>
          <ul className="sh-tiles">
            {tile(ROUTES.approvals, "shield", "Approvals", attention ? (a ? `${a} waiting` : "None waiting") : undefined, a ? "warn" : undefined)}
            {tile(ROUTES.exceptions, "alert", "Exceptions", attention ? (x ? `${x} open` : "None open") : undefined, x ? "bad" : undefined)}
          </ul>
          <h4 className="sh-more-h">Account</h4>
          <ul className="sh-tiles">
            {tile(ROUTES.usage, "wallet", "Usage", `Balance ${eur(user.credits)}`)}
            {tile(ROUTES.routines, "redo", "Recurring objectives")}
            {!isGuest && tile(ROUTES.members, "users", "Organization members", user.team?.name)}
            {!isGuest && tile(ROUTES.settings, "settings", "Settings")}
            {user.isAdmin && tile(ROUTES.admin, "chart", "Operations", "Admin")}
          </ul>
        </nav>
      </Modal>
    </>
  );
}

function BottomTab({ tab }: { tab: Tab }) {
  return (
    <Link href={tab.href!} className={cx("sh-tab", tab.on && "on", tab.primary && "primary")} aria-current={tab.on ? "page" : undefined}>
      <span className="sh-tab-ico">
        <Icon name={tab.icon} />
        {tab.badge && (
          <span className={cx("sh-tab-badge", tab.badge.tone)} aria-hidden="true">
            {capped(tab.badge.n)}
          </span>
        )}
      </span>
      <span className="sh-tab-lbl">
        {tab.label}
        {tab.badge && <span className="sr-only">{tab.badge.sr}</span>}
      </span>
    </Link>
  );
}

export default Header;
