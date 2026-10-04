"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, Icon, Modal, RequireAuth, Tag, ThemeSwitch, useToast } from "@/components";
import { api, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { eur, longDate } from "@/lib/format";
import { useLocalStorage } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";

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
  return (
    <div className="wrap" style={{ paddingBottom: 40 }}>
      <div className="pagehead">
        <h1>Settings</h1>
        <p>Manage your profile, password, appearance and notifications.</p>
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
          <AppearanceCard />
          <NotificationsCard userId={user.id} />
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
    () => ({ name: user.name, role: user.role ?? "", company: user.company ?? "", builds: user.builds ?? "" }),
    [user.name, user.role, user.company, user.builds]
  );
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setForm(initial), [initial]);

  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k].trim() !== initial[k]);
  const nameErr = form.name.trim() ? null : "Your name can't be empty.";
  const isDev = user.accountType === "DEVELOPER";

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
      if (isDev) body.builds = form.builds.trim() || null;
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
        {isDev && (
          <div>
            <label className="l" htmlFor="pf-builds">
              What you build
            </label>
            <textarea id="pf-builds" className="f" rows={3} value={form.builds} onChange={set("builds")} maxLength={500} placeholder="e.g. Research and data-extraction agents" />
          </div>
        )}
        <div>
          <label className="l" htmlFor="pf-email">
            Email
          </label>
          <input id="pf-email" className="f" value={user.email} readOnly aria-describedby="pf-email-hint" style={{ color: "var(--muted)" }} />
          <div className="hint" id="pf-email-hint">
            Your sign-in email. Contact support to change it.
          </div>
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
      await api.changePassword({ currentPassword: cur, newPassword: next });
      setCur("");
      setNext("");
      setConfirm("");
      toast("Password updated", { icon: "lock" });
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
const NOTIF_OPTS = [
  ["taskDone", "Task completed", "When a deliverable is ready to open."],
  ["taskFailed", "Task failed or needs attention", "Includes automatic refunds."],
  ["wfRun", "Workflow ran", "Each time a scheduled workflow starts a task."],
  ["digest", "Weekly summary email", "A Monday recap of spend and results."],
] as const;
type NotifKey = (typeof NOTIF_OPTS)[number][0];

function NotificationsCard({ userId }: { userId: string }) {
  const toast = useToast();
  const [prefs, setPrefs] = useLocalStorage<Record<NotifKey, boolean>>(`ens.notifprefs.${userId}`, {
    taskDone: true,
    taskFailed: true,
    wfRun: true,
    digest: false,
  });
  return (
    <section className="card" id="notifications" style={anchor} aria-labelledby="h-notif">
      <div className="row between">
        <h3 id="h-notif" style={{ margin: 0 }}>
          Notifications
        </h3>
        <Tag variant="gray" icon="monitor">
          This device
        </Tag>
      </div>
      <div className="stack" style={{ marginTop: 12, gap: 12 }}>
        {NOTIF_OPTS.map(([k, label, sub]) => (
          <label key={k} className="row between" style={{ cursor: "pointer", alignItems: "flex-start" }}>
            <span>
              <span className="small" style={{ fontWeight: 600 }}>
                {label}
              </span>
              <span className="tiny muted" style={{ display: "block" }}>
                {sub}
              </span>
            </span>
            <input
              type="checkbox"
              checked={!!prefs[k]}
              onChange={(e) => {
                const on = e.target.checked;
                setPrefs((p) => ({ ...p, [k]: on }));
                toast(`${label}: ${on ? "on" : "off"}`, { icon: "bell", duration: 1600 });
              }}
              style={{ marginTop: 3 }}
            />
          </label>
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Preferences are stored on this device. In-app alerts appear under the bell in the header.
      </p>
    </section>
  );
}

// ------------------------------------------------------------- account
function AccountCard({ user }: { user: User }) {
  const isDev = user.accountType === "DEVELOPER";
  return (
    <section className="card" id="account" style={anchor} aria-labelledby="h-acct">
      <h3 id="h-acct">Account</h3>
      <div style={{ marginTop: 8 }}>
        <div className="kv">
          <span className="muted">Account type</span>
          <Tag variant={isDev ? "accent" : "gray"} icon={isDev ? "code" : "user"}>
            {isDev ? "Developer" : "Company"}
          </Tag>
        </div>
        <div className="kv">
          <span className="muted">Member since</span>
          <b>{longDate(user.createdAt)}</b>
        </div>
        <div className="kv">
          <span className="muted">Demo credits</span>
          <b>{eur(user.credits)}</b>
        </div>
        <div className="kv" style={{ borderBottom: 0 }}>
          <span className="muted">Plan</span>
          <b>Pay as you go</b>
        </div>
      </div>
      <p className="small muted" style={{ margin: "8px 0 12px" }}>
        {isDev
          ? "You can publish agents to the marketplace and earn 80% of every task they run — and hire agents for your own work too."
          : "You hire agent teams for outcomes. Building agents yourself? Developer accounts can publish to the marketplace."}
      </p>
      <div className="row wrapflex">
        {isDev ? (
          <Link className="btn sm" href={ROUTES.devDashboard}>
            <Icon name="chart" />
            Developer dashboard
          </Link>
        ) : (
          <Link className="btn sm" href={ROUTES.developers}>
            <Icon name="code" />
            For developers
          </Link>
        )}
        <Link className="btn sm" href={ROUTES.billing}>
          <Icon name="wallet" />
          Payments
        </Link>
      </div>
    </section>
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
          <div className="tiny muted">Permanently remove your account, tasks and workflows.</div>
        </div>
        <button type="button" className="btn bad sm" onClick={() => setDel(true)}>
          <Icon name="trash" />
          Delete
        </button>
      </div>

      <Modal open={confirmOut} onClose={() => setConfirmOut(false)} title="Sign out?">
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          You'll need your email and password to get back in. Running tasks keep going while you're away.
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
          Self-service account deletion isn't available yet. To delete your account and all its data, contact support and we'll take care of it — usually within two business days.
        </p>
        <div className="notice" style={{ marginBottom: 16, background: "var(--surface2)", color: "var(--muted)" }}>
          <Icon name="info" />
          <span>Your demo credits, tasks and workflows stay untouched until then.</span>
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
