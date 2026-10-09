"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, Icon, Modal, PageHead, RequireAuth, Tag, ThemeSwitch, useToast } from "@/components";
import { api, setToken, type Autonomy, type Organization, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CONTACT_EMAIL, useConfig } from "@/lib/config";
import { toastApiError } from "@/lib/errors";
import { eur, longDate } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import S from "./settings.module.css";

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  );
}

const SECTIONS = [
  ["profile", "Profile"],
  ["security", "Password"],
  ["organization", "Organization"],
  ["appearance", "Appearance"],
  ["notifications", "Notifications"],
  ["account", "Account"],
  ["danger", "Danger zone"],
] as const;

function Settings() {
  const { user } = useAuth();

  // Content renders after auth resolves, so honour #profile etc. once mounted.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: "start" });
      const focusable = el.querySelector<HTMLElement>("input, button");
      focusable?.focus({ preventScroll: true });
    }
  }, []);

  if (!user) return null;
  if (user.isGuest) return <GuestSettings user={user} />;
  return (
    <div className="wrap op-page">
      <PageHead eyebrow="Account" title="Settings" sub="Your profile, password, organization policy, appearance and email." />
      <div className="op-set">
        <nav aria-label="Settings sections" className="op-set-nav">
          <ul>
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="op-set-main">
          <ProfileCard user={user} />
          <PasswordCard />
          <OrganizationCard />
          <AppearanceCard />
          <NotificationsCard user={user} />
          <AccountCard user={user} />
          <DangerCard />
        </div>
      </div>
    </div>
  );
}

const anchor = { scrollMarginTop: 90 } as const;

function CardHead({ id, title, sub, lead }: { id: string; title: string; sub?: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <div className="op-card-h">
      {lead}
      <div style={{ minWidth: 0 }}>
        <h2 id={id}>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- profile
function ProfileCard({ user }: { user: User }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const initial = useMemo(
    () => ({ name: user.name, role: user.role ?? "", company: user.company ?? "" }),
    [user.name, user.role, user.company]
  );
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setForm(initial), [initial]);

  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k].trim() !== initial[k]);
  const nameErr = form.name.trim() ? null : "Your name can't be empty.";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nameErr || !dirty) return;
    setSaving(true);
    setErr(null);
    try {
      const body: Parameters<typeof api.updateMe>[0] = {
        name: form.name.trim(),
        role: form.role.trim() || null,
        company: form.company.trim() || null,
      };
      const { user: u } = await api.updateMe(body);
      setUser(u);
      toast("Profile saved");
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form className="op-panel op-card" id="profile" onSubmit={save} aria-labelledby="h-profile">
      <CardHead id="h-profile" title="Profile" sub="How you appear across Ensemblis." lead={<Avatar name={form.name || user.name} round size="md" />} />
      <div className="op-fieldset">
        <div className="op-two">
        <div>
          <label className="l" htmlFor="pf-name">
            Full name
          </label>
          <input id="pf-name" className="f" value={form.name} onChange={set("name")} autoComplete="name" aria-invalid={!!nameErr} maxLength={120} />
          {nameErr && <div className="err">{nameErr}</div>}
        </div>
        <div>
          <label className="l" htmlFor="pf-role">
            Role
          </label>
          <input id="pf-role" className="f" value={form.role} onChange={set("role")} placeholder="e.g. Head of Strategy" autoComplete="organization-title" maxLength={120} />
        </div>
        </div>
        <div className="op-two">
        <div>
          <label className="l" htmlFor="pf-company">
            Company
          </label>
          <input id="pf-company" className="f" value={form.company} onChange={set("company")} autoComplete="organization" maxLength={160} />
        </div>
        <div>
          <label className="l" htmlFor="pf-email">
            Email
          </label>
          <input id="pf-email" className="f" value={user.email} readOnly aria-describedby="pf-email-hint" style={{ color: "var(--muted)" }} />
          <div className="hint" id="pf-email-hint">
            Your sign-in email. {CONTACT_EMAIL ? `Write to ${CONTACT_EMAIL} to change it.` : "The operator of this deployment can change it."}
          </div>
          <EmailVerification user={user} />
        </div>
        </div>
      </div>
      {err && (
        <div className="err" role="alert" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
      <div className="op-actions">
        <button type="submit" className="btn p sm" disabled={!dirty || !!nameErr || saving} aria-busy={saving}>
          Save changes
        </button>
        {dirty && (
          <button type="button" className="btn sm" onClick={() => setForm(initial)}>
            Discard
          </button>
        )}
        {!dirty && <span className="op-meta">All changes saved</span>}
      </div>
    </form>
  );
}

// ------------------------------------------------------------- password
function PasswordCard() {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: "cur" | "next" | "confirm" | "form"; msg: string } | null>(null);

  const strength = useMemo(() => {
    let s = 0;
    if (next.length >= 8) s++;
    if (next.length >= 12) s++;
    if (/[A-Z]/.test(next) && /[a-z]/.test(next)) s++;
    if (/\d/.test(next) && /[^A-Za-z0-9]/.test(next)) s++;
    return s;
  }, [next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cur) return setErr({ field: "cur", msg: "Enter your current password." });
    if (next.length < 8) return setErr({ field: "next", msg: "New password must be at least 8 characters." });
    if (next === cur) return setErr({ field: "next", msg: "Choose a password different from your current one." });
    if (next !== confirm) return setErr({ field: "confirm", msg: "Passwords don't match." });
    setErr(null);
    setBusy(true);
    try {
      const res = await api.changePassword({ currentPassword: cur, newPassword: next });
      // Other devices are now signed out; keep this one signed in with the fresh token.
      if (res.token) setToken(res.token);
      setCur("");
      setNext("");
      setConfirm("");
      toast("Password updated — you've been signed out on other devices", { icon: "lock" });
    } catch (e2) {
      const ex = e2 as Error & { status?: number };
      setErr({ field: ex.status === 400 && /current/i.test(ex.message) ? "cur" : "form", msg: ex.message });
    } finally {
      setBusy(false);
    }
  };

  const type = show ? "text" : "password";
  return (
    <form className="op-panel op-card" id="security" onSubmit={submit} aria-labelledby="h-pw" noValidate>
      <CardHead id="h-pw" title="Password" sub="Changing it signs you out on every other device." />
      <div className="op-fieldset">
        <div>
          <label className="l" htmlFor="pw-cur">
            Current password
          </label>
          <input id="pw-cur" className="f" type={type} value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" aria-invalid={err?.field === "cur"} />
          {err?.field === "cur" && <div className="err">{err.msg}</div>}
        </div>
        <div>
          <label className="l" htmlFor="pw-new">
            New password
          </label>
          <input id="pw-new" className="f" type={type} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-invalid={err?.field === "next"} aria-describedby="pw-strength" />
          {err?.field === "next" ? (
            <div className="err">{err.msg}</div>
          ) : (
            <div className="hint row" id="pw-strength" style={{ gap: 8 }}>
              <span className="meter" style={{ width: 90 }} aria-hidden="true">
                <i style={{ width: `${next ? (strength / 4) * 100 : 0}%`, background: strength <= 1 ? "var(--bad)" : strength === 2 ? "var(--warn)" : "var(--ok)" }} />
              </span>
              {next ? ["Too short", "Weak", "Okay", "Strong", "Very strong"][strength] : "At least 8 characters"}
            </div>
          )}
        </div>
        <div>
          <label className="l" htmlFor="pw-confirm">
            Confirm new password
          </label>
          <input id="pw-confirm" className="f" type={type} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={err?.field === "confirm"} />
          {err?.field === "confirm" && <div className="err">{err.msg}</div>}
        </div>
        <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show passwords
        </label>
      </div>
      {err?.field === "form" && (
        <div className="err" role="alert" style={{ marginTop: 10 }}>
          {err.msg}
        </div>
      )}
      <div className="op-actions">
        <button type="submit" className="btn sm p" disabled={busy || !cur || !next || !confirm} aria-busy={busy}>
          Update password
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------- appearance
function AppearanceCard() {
  return (
    <section className="op-panel op-card" id="appearance" aria-labelledby="h-app">
      <CardHead id="h-app" title="Appearance" sub="Choose a theme. System follows your device setting." />
      <ThemeSwitch />
    </section>
  );
}

// ------------------------------------------------------------- notifications
function NotificationsCard({ user }: { user: User }) {
  const { setUser } = useAuth();
  const { config, loaded } = useConfig();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const on = !!user.emailOnTaskDone;

  const toggle = async () => {
    if (saving) return;
    const next = !on;
    setSaving(true);
    setUser((u) => (u ? { ...u, emailOnTaskDone: next } : u)); // optimistic
    try {
      const { user: u } = await api.updateMe({ emailOnTaskDone: next });
      setUser(u);
      toast(next ? "You'll get an email when an objective finishes or needs you" : "Objective emails turned off", { icon: next ? "mail" : "bell", duration: 2200 });
    } catch (e) {
      setUser((u) => (u ? { ...u, emailOnTaskDone: on } : u));
      toastApiError(toast, e, "Couldn't save your email preference");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="op-panel op-card" id="notifications" aria-labelledby="h-notif">
      <CardHead id="h-notif" title="Email notifications" />
      <div className={S.toggleRow} style={{ paddingTop: 0 }}>
        <span>
          <span className="small" id="nt-done-label" style={{ fontWeight: 600, display: "block" }}>
            Email me when an objective finishes or needs me
          </span>
          <span className="tiny muted" id="nt-done-hint" style={{ display: "block", marginTop: 2 }}>
            A short note with a link to the objective, sent to <b style={{ color: "var(--ink)", wordBreak: "break-all" }}>{user.email}</b>.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="nt-done-label"
          aria-describedby="nt-done-hint"
          className={S.switch}
          onClick={toggle}
          disabled={saving}
        />
      </div>
      {loaded && !config.emailEnabled && (
        <div className="notice" style={{ marginTop: 4, background: "var(--surface2)", color: "var(--muted)" }}>
          <Icon name="info" />
          <span>
            <b style={{ color: "var(--ink)" }}>Email isn&apos;t enabled on this server yet.</b> Your choice is saved and applies as soon as it is.
          </span>
        </div>
      )}
      <p className="op-note">Approvals and exceptions always appear in the header, on Home and in the Approval and Exception centers.</p>
    </section>
  );
}

// ------------------------------------------------------------- account
function AccountCard({ user }: { user: User }) {
  const teamWallet = user.walletOwner === "team";
  return (
    <section className="op-panel op-card" id="account" aria-labelledby="h-acct">
      <CardHead id="h-acct" title="Account" />
      <div>
        <div className="op-kv">
          <span>Member since</span>
          <b>{longDate(user.createdAt)}</b>
        </div>
        <div className="op-kv" id="team" style={anchor}>
          <span>Organization members</span>
          <Link href={ROUTES.members} className="row" style={{ gap: 8, color: "var(--ink)", minWidth: 0 }}>
            {user.team ? (
              <>
                <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{user.team.name}</b>
                <Tag variant={user.team.role === "OWNER" ? "accent" : "gray"}>{user.team.role === "OWNER" ? "Owner" : "Member"}</Tag>
              </>
            ) : (
              <span className="small" style={{ color: "var(--accent)", fontWeight: 600 }}>
                Invite colleagues
              </span>
            )}
            <Icon name="chev" size={14} />
          </Link>
        </div>
        <div className="op-kv">
          <span>
            Balance
            {teamWallet && <span className="op-meta"> · organization balance</span>}
          </span>
          <b>{eur(user.credits)}</b>
        </div>
        <div className="op-kv">
          <span>Plan</span>
          <b>Usage-based</b>
        </div>
      </div>
      <div className="op-actions">
        <Link className="btn sm" href={ROUTES.usage}>
          <Icon name="wallet" />
          Usage & balance
        </Link>
        <Link className="btn sm" href={ROUTES.members}>
          <Icon name="user" />
          Members
        </Link>
      </div>
    </section>
  );
}

// ------------------------------------------------------------- email verification
function EmailVerification({ user }: { user: User }) {
  const toast = useToast();
  const { loaded, config } = useConfig();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  if (user.emailVerified) {
    return (
      <div className="tiny" style={{ marginTop: 6, color: "var(--ok)" }}>
        <Icon name="check" size={12} /> Verified
      </div>
    );
  }
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.requestEmailVerification();
      setSent(true);
      toast(r.sent ? "Verification link sent — check your inbox" : "Verification requested", { icon: "mail" });
    } catch (e) {
      toastApiError(toast, e, "Couldn't send the verification email");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row wrapflex" style={{ marginTop: 8, gap: 8 }}>
      <Tag variant="warn">Not verified</Tag>
      <button type="button" className="btn sm" onClick={send} disabled={busy || sent} aria-busy={busy}>
        {sent ? "Link sent" : "Send verification link"}
      </button>
      {loaded && !config.emailEnabled && <span className="tiny muted">Email isn&apos;t enabled on this server — an operator can verify you instead.</span>}
    </div>
  );
}

// ------------------------------------------------------------- organization policy
const AUTONOMY: { id: Autonomy; title: string; sub: string }[] = [
  { id: "REVIEW_PLAN", title: "Review the plan first", sub: "Every plan waits in Approvals before any work starts." },
  { id: "AUTO_WITHIN_BUDGET", title: "Execute automatically within budget", sub: "Plans under the approval threshold start on their own." },
];

/** Radio cards with the radio-group keyboard pattern (one tab stop, arrow keys move and select). */
function AutonomyChoice({ value, onChange, disabled }: { value: Autonomy; onChange: (a: Autonomy) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = AUTONOMY.findIndex((a) => a.id === value);
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % AUTONOMY.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + AUTONOMY.length) % AUTONOMY.length;
    if (n < 0) return;
    e.preventDefault();
    onChange(AUTONOMY[n].id);
    refs.current[n]?.focus();
  };
  return (
    <div>
      <span className="l" id="org-autonomy-l">
        Default autonomy for new objectives
      </span>
      <div className="op-radios" role="radiogroup" aria-labelledby="org-autonomy-l" onKeyDown={onKey}>
        {AUTONOMY.map((a, i) => (
          <button
            key={a.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={value === a.id}
            tabIndex={value === a.id ? 0 : -1}
            className="op-radio"
            disabled={disabled}
            onClick={() => onChange(a.id)}
          >
            <b>{a.title}</b>
            <span>{a.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function OrganizationCard() {
  const toast = useToast();
  const [org, setOrg] = useState<Organization | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [autonomy, setAutonomy] = useState<Autonomy>("REVIEW_PLAN");
  const [threshold, setThreshold] = useState(20);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setFailed(false);
    api
      .getOrg()
      .then(({ organization: o }) => {
        setOrg(o);
        setName(o.name);
        setAutonomy(o.defaultAutonomy);
        setThreshold(Math.round(o.approvalThresholdCents / 100));
      })
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  if (!org) {
    return (
      <section className="op-panel op-card" id="organization" aria-labelledby="h-org" aria-busy={!failed}>
        <CardHead id="h-org" title="Organization" sub="How much the AI Team may do without asking." />
        {failed ? (
          <div className="op-inline">
            <span className="small muted">The organization policy couldn&apos;t be loaded.</span>
            <button type="button" className="btn sm" onClick={load}>
              <Icon name="redo" />
              Try again
            </button>
          </div>
        ) : (
          <p className="op-meta">Loading the organization policy…</p>
        )}
      </section>
    );
  }
  const owner = org.role === "OWNER";
  const thresholdCents = Math.max(0, Math.min(50_000, Math.round(threshold * 100)));
  const dirty = name.trim() !== org.name || autonomy !== org.defaultAutonomy || thresholdCents !== org.approvalThresholdCents;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || name.trim().length < 2) return;
    setSaving(true);
    try {
      const { organization } = await api.updateOrg({ name: name.trim(), defaultAutonomy: autonomy, approvalThresholdCents: thresholdCents });
      setOrg(organization);
      toast("Organization policy saved");
    } catch (e2) {
      toastApiError(toast, e2, "Couldn't save the organization policy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="op-panel op-card" id="organization" onSubmit={save} aria-labelledby="h-org">
      <CardHead id="h-org" title="Organization" sub={`How much the AI Team may do without asking.${owner ? "" : " Only the organization owner can change this."}`} />
      <fieldset disabled={!owner} className="op-fieldset">
        <div>
          <label className="l" htmlFor="org-name">
            Name
          </label>
          <input id="org-name" className="f" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <AutonomyChoice value={autonomy} onChange={setAutonomy} disabled={!owner} />
        <div>
          <label className="l" htmlFor="org-threshold">
            Approval threshold
          </label>
          <div className="op-money">
            <span className="muted" aria-hidden="true">
              €
            </span>
            <input id="org-threshold" className="f" type="number" min={0} max={500} step={1} value={threshold} aria-describedby="org-threshold-hint" onChange={(e) => setThreshold(Number(e.target.value || 0))} />
          </div>
          <p className="hint" id="org-threshold-hint">
            In euros. Any execution estimated above this needs explicit approval, whatever the objective&apos;s autonomy. €0 means every execution asks.
          </p>
        </div>
      </fieldset>
      {owner && (
        <div className="op-actions">
          <button type="submit" className="btn p sm" disabled={!dirty || saving || name.trim().length < 2} aria-busy={saving}>
            Save policy
          </button>
          {!dirty && <span className="op-meta">All changes saved</span>}
        </div>
      )}
      <p className="op-note">
        Whatever the policy, the AI Team only reads, researches, analyses and drafts. It never sends, publishes, changes external systems or spends money outside an approved execution.
      </p>
    </form>
  );
}

// ------------------------------------------------------------- guests
/** Guest-trial accounts have no profile or password yet: offer to save the trial instead. */
function GuestSettings({ user }: { user: User }) {
  const { signOut } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const claimHref = `${ROUTES.signup}?claim=1&next=${encodeURIComponent(ROUTES.settings)}`;

  const endSession = () => {
    setConfirmEnd(false);
    signOut();
    toast("Guest session ended");
    router.push(ROUTES.home);
  };

  return (
    <div className="wrap op-page">
      <PageHead eyebrow="Account" title="Settings" sub="You're on a free trial. Create a free account to get a profile, a password and email updates." />
      <div className="grid g2" style={{ alignItems: "start" }}>
        <div className="stack">
          <section className={`op-panel op-card ${S.guestCta}`} id="profile" aria-labelledby="h-guest">
            <span className={S.guestIco} aria-hidden="true">
              <Icon name="user" size={20} />
            </span>
            <h2 id="h-guest" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.15 }}>
              Create a free account
            </h2>
            <p className="small muted" style={{ marginTop: 6 }}>
              It takes a minute, and nothing from your trial is lost.
            </p>
            <ul className={S.perks}>
              {[
                "Keep your trial objective and its results — no 7-day limit",
                "Sign in from any device with your email and password",
                "Get an email when an objective finishes or needs you",
                "Company Context, memory and recurring objectives",
              ].map((p) => (
                <li key={p}>
                  <Icon name="check" size={15} />
                  {p}
                </li>
              ))}
            </ul>
            <Link className="btn p" href={claimHref}>
              Create a free account
              <Icon name="arrow" />
            </Link>
          </section>
        </div>
        <div className="stack">
          <AppearanceCard />
          <section className="op-panel op-card" id="account" aria-labelledby="h-trial">
            <CardHead id="h-trial" title="Free trial" />
            <div>
              <div className="op-kv">
                <span>Trial balance left</span>
                <b>{eur(user.credits)}</b>
              </div>
              <div className="op-kv">
                <span>Started</span>
                <b>{longDate(user.createdAt)}</b>
              </div>
              <div className="op-kv">
                <span>Results kept</span>
                <b>7 days unless you save them</b>
              </div>
            </div>
          </section>
          <section className="op-panel op-card" id="danger" aria-labelledby="h-end">
            <CardHead id="h-end" title="End trial session" />
            <div className="op-danger-row">
              <p style={{ marginTop: 0 }}>Signs this browser out of the trial. You won&apos;t be able to get back to your trial results afterwards.</p>
              <button type="button" className="btn sm" onClick={() => setConfirmEnd(true)}>
                <Icon name="out" />
                End session
              </button>
            </div>
          </section>
        </div>
      </div>

      <Modal open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End your free trial?">
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          Guest sessions don&apos;t have a password, so once you end this one your trial objective and its results can&apos;t be opened again. Save them with a free account first if you want to keep them.
        </p>
        <div className="row wrapflex">
          <Link className="btn p" href={claimHref} data-autofocus>
            Save my work
          </Link>
          <button type="button" className="btn bad" onClick={endSession}>
            End session
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------- danger zone
function DangerCard() {
  const { signOut } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [confirmOut, setConfirmOut] = useState(false);
  const [del, setDel] = useState(false);

  const doSignOut = () => {
    setConfirmOut(false);
    signOut();
    toast("Signed out");
    router.push(ROUTES.home);
  };

  return (
    <section className="op-panel op-card op-danger" id="danger" aria-labelledby="h-danger">
      <CardHead id="h-danger" title="Danger zone" />
      <div className="op-danger-row">
        <div>
          <b>Sign out of this device</b>
          <p>Ends your session in this browser. To sign out other devices too, change your password above.</p>
        </div>
        <button type="button" className="btn sm" onClick={() => setConfirmOut(true)}>
          <Icon name="out" />
          Sign out
        </button>
      </div>
      <div className="op-danger-row">
        <div>
          <b>Delete account</b>
          <p>Permanently remove your account, objectives and reports.</p>
        </div>
        <button type="button" className="btn bad sm" onClick={() => setDel(true)}>
          <Icon name="trash" />
          Delete
        </button>
      </div>

      <Modal open={confirmOut} onClose={() => setConfirmOut(false)} title="Sign out?">
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          You&apos;ll need your email and password to get back in. Executions in progress continue while you&apos;re away.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => setConfirmOut(false)} data-autofocus>
            Stay signed in
          </button>
          <button type="button" className="btn p sp" onClick={doSignOut}>
            Sign out
          </button>
        </div>
      </Modal>

      <Modal open={del} onClose={() => setDel(false)} title="Delete your account">
        <p className="muted small" style={{ margin: "6px 0 12px" }}>
          Self-service account deletion isn&apos;t available yet.{" "}
          {CONTACT_EMAIL
            ? `To delete your account and all its data, write to ${CONTACT_EMAIL} from your sign-in address.`
            : "To delete your account and all its data, ask the operator of this Ensemblis deployment."}
        </p>
        <div className="notice" style={{ marginBottom: 16, background: "var(--surface2)", color: "var(--muted)" }}>
          <Icon name="info" />
          <span>Your balance, objectives and reports stay untouched until then.</span>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setDel(false)} data-autofocus>
            Close
          </button>
          {CONTACT_EMAIL && (
            <a className="btn bad sp" href={`mailto:${CONTACT_EMAIL}?subject=Delete%20my%20Ensemblis%20account`}>
              <Icon name="mail" />
              Email {CONTACT_EMAIL}
            </a>
          )}
        </div>
      </Modal>
    </section>
  );
}
