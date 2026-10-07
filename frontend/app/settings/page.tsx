"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, Icon, Modal, RequireAuth, Tag, ThemeSwitch, useToast } from "@/components";
import { api, setToken, type Autonomy, type Organization, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
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
    <div className="wrap" style={{ paddingBottom: 40 }}>
      <div className="pagehead">
        <h1>Settings</h1>
        <p>Your profile, password, organization policy, appearance and email.</p>
      </div>
      <nav aria-label="Settings sections" className="row wrapflex" style={{ gap: 6, marginBottom: 18 }}>
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="chip">
            {label}
          </a>
        ))}
      </nav>
      <div className="grid g2" style={{ alignItems: "start" }}>
        <div className="stack">
          <ProfileCard user={user} />
          <PasswordCard />
        </div>
        <div className="stack">
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
    <form className="card" id="profile" style={anchor} onSubmit={save} aria-labelledby="h-profile">
      <div className="row" style={{ gap: 12 }}>
        <Avatar name={form.name || user.name} round size="md" />
        <div className="sp">
          <h3 id="h-profile" style={{ margin: 0 }}>
            Profile
          </h3>
          <div className="tiny muted">How you appear across Ensemblis.</div>
        </div>
      </div>
      <div className="stack" style={{ marginTop: 14 }}>
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
            Your sign-in email. Contact support to change it.
          </div>
          <EmailVerification user={user} />
        </div>
      </div>
      {err && (
        <div className="err" role="alert" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="submit" className="btn p sm" disabled={!dirty || !!nameErr || saving} aria-busy={saving}>
          Save changes
        </button>
        {dirty && (
          <button type="button" className="btn sm" onClick={() => setForm(initial)}>
            Discard
          </button>
        )}
        {!dirty && <span className="tiny muted">All changes saved</span>}
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
    <form className="card" id="security" style={anchor} onSubmit={submit} aria-labelledby="h-pw" noValidate>
      <h3 id="h-pw">Change password</h3>
      <div className="stack" style={{ marginTop: 12 }}>
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
      <button type="submit" className="btn sm p" style={{ marginTop: 14 }} disabled={busy || !cur || !next || !confirm} aria-busy={busy}>
        Update password
      </button>
    </form>
  );
}

// ------------------------------------------------------------- appearance
function AppearanceCard() {
  return (
    <section className="card" id="appearance" style={anchor} aria-labelledby="h-app">
      <h3 id="h-app">Appearance</h3>
      <p className="small muted" style={{ margin: "4px 0 12px" }}>
        Choose a theme. System follows your device setting.
      </p>
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
    <section className="card" id="notifications" style={anchor} aria-labelledby="h-notif">
      <h3 id="h-notif" style={{ margin: 0 }}>
        Email notifications
      </h3>
      <div className={S.toggleRow} style={{ marginTop: 4 }}>
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
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Approvals and exceptions always appear in the header, the briefing and their own centers.
      </p>
    </section>
  );
}

// ------------------------------------------------------------- account
function AccountCard({ user }: { user: User }) {
  const teamWallet = user.walletOwner === "team";
  return (
    <section className="card" id="account" style={anchor} aria-labelledby="h-acct">
      <h3 id="h-acct">Account</h3>
      <div style={{ marginTop: 8 }}>
        <div className="kv">
          <span className="muted">Member since</span>
          <b>{longDate(user.createdAt)}</b>
        </div>
        <div className="kv" id="team" style={anchor}>
          <span className="muted">Organization members</span>
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
        <div className="kv">
          <span className="muted">
            Balance
            {teamWallet && <span className="tiny"> · organization wallet</span>}
          </span>
          <b>{eur(user.credits)}</b>
        </div>
        <div className="kv" style={{ borderBottom: 0 }}>
          <span className="muted">Plan</span>
          <b>Usage-based</b>
        </div>
      </div>
      <div className="row wrapflex" style={{ marginTop: 12 }}>
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
function OrganizationCard() {
  const toast = useToast();
  const [org, setOrg] = useState<Organization | null>(null);
  const [name, setName] = useState("");
  const [autonomy, setAutonomy] = useState<Autonomy>("REVIEW_PLAN");
  const [threshold, setThreshold] = useState(20);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getOrg()
      .then(({ organization: o }) => {
        setOrg(o);
        setName(o.name);
        setAutonomy(o.defaultAutonomy);
        setThreshold(Math.round(o.approvalThresholdCents / 100));
      })
      .catch(() => undefined);
  }, []);

  if (!org) {
    return (
      <section className="card" id="organization" style={anchor}>
        <h3>Organization</h3>
        <div className="sk" style={{ height: 80, marginTop: 10 }} />
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
    <form className="card" id="organization" style={anchor} onSubmit={save} aria-labelledby="h-org">
      <h3 id="h-org">Organization</h3>
      <p className="small muted" style={{ margin: "4px 0 12px" }}>
        How much the AI Team may do without asking. {owner ? "" : "Only the organization owner can change this."}
      </p>
      <fieldset disabled={!owner} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div>
          <label className="l" htmlFor="org-name">
            Name
          </label>
          <input id="org-name" className="f" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div>
          <label className="l">Default autonomy for new objectives</label>
          <div className="seg" role="radiogroup" aria-label="Default autonomy">
            <button type="button" role="radio" aria-checked={autonomy === "REVIEW_PLAN"} className={autonomy === "REVIEW_PLAN" ? "on" : ""} onClick={() => setAutonomy("REVIEW_PLAN")}>
              Review the plan first
            </button>
            <button type="button" role="radio" aria-checked={autonomy === "AUTO_WITHIN_BUDGET"} className={autonomy === "AUTO_WITHIN_BUDGET" ? "on" : ""} onClick={() => setAutonomy("AUTO_WITHIN_BUDGET")}>
              Run automatically within budget
            </button>
          </div>
        </div>
        <div>
          <label className="l" htmlFor="org-threshold">
            Approval threshold
          </label>
          <div className="row" style={{ gap: 8, maxWidth: 200 }}>
            <span className="muted">€</span>
            <input id="org-threshold" className="f" type="number" min={0} max={500} step={1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value || 0))} />
          </div>
          <p className="hint">Any execution estimated above this needs explicit approval, whatever the objective&apos;s autonomy. €0 means every execution asks.</p>
        </div>
      </fieldset>
      {owner && (
        <div className="row" style={{ marginTop: 14 }}>
          <button type="submit" className="btn p sm" disabled={!dirty || saving || name.trim().length < 2} aria-busy={saving}>
            Save policy
          </button>
          {!dirty && <span className="tiny muted">All changes saved</span>}
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 12 }}>
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
    <div className="wrap" style={{ paddingBottom: 40 }}>
      <div className="pagehead">
        <h1>Settings</h1>
        <p>You&apos;re on a free trial. Create a free account to get a profile, a password and email updates.</p>
      </div>
      <div className="grid g2" style={{ alignItems: "start" }}>
        <div className="stack">
          <section className={`card ${S.guestCta}`} id="profile" style={anchor} aria-labelledby="h-guest">
            <span className={S.guestIco} aria-hidden="true">
              <Icon name="spark" size={20} />
            </span>
            <h3 id="h-guest" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.15 }}>
              Create a free account
            </h3>
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
          <section className="card" id="account" style={anchor} aria-labelledby="h-trial">
            <h3 id="h-trial">Free trial</h3>
            <div style={{ marginTop: 8 }}>
              <div className="kv">
                <span className="muted">Trial credits left</span>
                <b>{eur(user.credits)}</b>
              </div>
              <div className="kv">
                <span className="muted">Started</span>
                <b>{longDate(user.createdAt)}</b>
              </div>
              <div className="kv" style={{ borderBottom: 0 }}>
                <span className="muted">Results kept</span>
                <b>7 days unless you save them</b>
              </div>
            </div>
          </section>
          <section className="card" id="danger" style={anchor} aria-labelledby="h-end">
            <h3 id="h-end">End trial session</h3>
            <div className="lane" style={{ borderBottom: 0 }}>
              <div className="sp">
                <div className="tiny muted">Signs this browser out of the trial. You won&apos;t be able to get back to your trial results afterwards.</div>
              </div>
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
    <section className="card" id="danger" style={{ ...anchor, borderColor: "color-mix(in srgb,var(--bad) 35%,var(--line))" }} aria-labelledby="h-danger">
      <h3 id="h-danger">Danger zone</h3>
      <div className="lane">
        <div className="sp">
          <b className="small">Sign out everywhere</b>
          <div className="tiny muted">Ends your session on this device and clears your sign-in.</div>
        </div>
        <button type="button" className="btn sm" onClick={() => setConfirmOut(true)}>
          <Icon name="out" />
          Sign out
        </button>
      </div>
      <div className="lane" style={{ borderBottom: 0 }}>
        <div className="sp">
          <b className="small">Delete account</b>
          <div className="tiny muted">Permanently remove your account, objectives and reports.</div>
        </div>
        <button type="button" className="btn bad sm" onClick={() => setDel(true)}>
          <Icon name="trash" />
          Delete
        </button>
      </div>

      <Modal open={confirmOut} onClose={() => setConfirmOut(false)} title="Sign out?">
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          You&apos;ll need your email and password to get back in. Objectives in progress keep running while you&apos;re away.
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
          Self-service account deletion isn&apos;t available yet. To delete your account and all its data, contact support and we&apos;ll take care of it — usually within two business days.
        </p>
        <div className="notice" style={{ marginBottom: 16, background: "var(--surface2)", color: "var(--muted)" }}>
          <Icon name="info" />
          <span>Your balance, objectives and reports stay untouched until then.</span>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setDel(false)} data-autofocus>
            Close
          </button>
          <a className="btn bad sp" href="mailto:support@ensemblis.ai?subject=Delete%20my%20Ensemblis%20account">
            <Icon name="mail" />
            Contact support
          </a>
        </div>
      </Modal>
    </section>
  );
}
