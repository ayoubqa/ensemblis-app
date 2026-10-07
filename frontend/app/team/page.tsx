"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Icon, RequireAuth, Skeleton, SkeletonText, confetti, useToast } from "@/components";
import { api, type TeamDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorText, toastApiError } from "@/lib/errors";
import { eur } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { MemberTeam } from "./_components/MemberTeam";
import { OwnerTeam } from "./_components/OwnerTeam";
import { TEAM_NAME_MAX, TeamExplainer, teamNameError } from "./_components/teamShared";

export default function TeamPage() {
  return (
    <RequireAuth>
      <TeamGate />
    </RequireAuth>
  );
}

function TeamGate() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.isGuest) return <GuestTeam />;
  return <TeamView />;
}

function GuestTeam() {
  return (
    <div className="narrow" style={{ padding: "40px 24px 56px" }}>
      <div className="card" style={{ padding: "clamp(22px,4vw,36px)" }}>
        <span className="tag warn">
          <Icon name="user" />
          Guest session
        </span>
        <h1 className="serif" style={{ fontSize: "clamp(26px,3.6vw,36px)", lineHeight: 1.1, margin: "12px 0 8px" }}>
          Create a free account to work as a team.
        </h1>
        <p className="muted" style={{ maxWidth: "56ch" }}>
          Teams share one credit wallet and one task history. Save your guest work to a free account first — everything you&apos;ve done so far
          comes with you.
        </p>
        <TeamExplainer compact />
        <div className="row wrapflex">
          <Link className="btn p" href={`${ROUTES.signup}?claim=1&next=${encodeURIComponent(ROUTES.team)}`}>
            <Icon name="check" />
            Save your work
          </Link>
          <Link className="btn" href={ROUTES.tasks}>
            Back to my work
          </Link>
        </div>
      </div>
    </div>
  );
}

function TeamView() {
  const { user, refresh } = useAuth();
  const [team, setTeam] = useState<TeamDetail | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.getTeam();
      setTeam(r.team);
    } catch (e) {
      setError(errorText(e, "Couldn't load your team."));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // If the header's view of the team is stale (joined/removed elsewhere), resync it.
  useEffect(() => {
    if (team === undefined || !user) return;
    if (!!team !== !!user.team || (team && user.team && (team.id !== user.team.id || team.role !== user.team.role || team.name !== user.team.name))) {
      refresh().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team]);

  if (error && team === undefined)
    return (
      <div className="wrap" style={{ paddingTop: 32 }}>
        <div className="notice" role="alert" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>
          <Icon name="alert" />
          <span className="sp">{error}</span>
          <button type="button" className="btn sm" onClick={load}>
            <Icon name="redo" />
            Try again
          </button>
        </div>
      </div>
    );

  if (team === undefined)
    return (
      <div className="wrap" aria-busy="true" aria-label="Loading your team">
        <div className="pagehead">
          <Skeleton width={90} height={22} />
          <Skeleton width="min(380px, 70%)" height={38} style={{ marginTop: 14 }} />
          <Skeleton width="min(520px, 90%)" height={14} style={{ marginTop: 12 }} />
        </div>
        <div className="grid g3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card tight">
              <SkeletonText lines={3} />
            </div>
          ))}
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <SkeletonText lines={5} />
        </div>
      </div>
    );

  if (!team) return <CreateTeam onCreated={setTeam} />;
  if (team.role === "OWNER") return <OwnerTeam team={team} setTeam={setTeam} />;
  return <MemberTeam team={team} setTeam={setTeam} />;
}

function CreateTeam({ onCreated }: { onCreated: (t: TeamDetail) => void }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(() => (user?.company ? `${user.company}` : ""));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameErr = teamNameError(name);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameErr) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createTeam(name.trim());
      setUser(r.user);
      onCreated(r.team);
      confetti();
      toast(`${r.team.name} is ready — invite your colleagues next`, { icon: "check" });
    } catch (e2) {
      setErr(errorText(e2, "Couldn't create the team"));
      toastApiError(toast, e2, "Couldn't create the team");
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="narrow" style={{ paddingBottom: 56 }}>
      <div className="pagehead">
        <span className="tag gray">
          <Icon name="share" />
          Teams
        </span>
        <h1 style={{ marginTop: 12 }}>Work together, from one wallet.</h1>
        <p>
          Create a team and invite colleagues with a link. Everyone can run tasks; they&apos;re all paid from your balance and everyone sees the
          team&apos;s history.
        </p>
      </div>

      <TeamExplainer />

      <form className="card" onSubmit={submit} noValidate>
        <label className="l" htmlFor="team-name">
          Team name
        </label>
        <input
          id="team-name"
          className="f"
          value={name}
          maxLength={TEAM_NAME_MAX}
          placeholder="e.g. Acme Growth"
          onChange={(e) => {
            setName(e.target.value);
            setErr(null);
          }}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && !!nameErr}
          aria-describedby="team-name-hint"
          autoComplete="organization"
        />
        {touched && nameErr ? (
          <div className="err" id="team-name-hint" role="alert">
            {nameErr}
          </div>
        ) : (
          <div className="hint" id="team-name-hint">
            You can rename it later.
          </div>
        )}
        <div className="notice" style={{ marginTop: 14, background: "var(--accent-soft)", color: "var(--accent)" }}>
          <Icon name="wallet" />
          <span>
            You&apos;ll be the owner. Your balance ({eur(user.credits)}) becomes the team wallet: members&apos; tasks are paid from it, and only you
            can add credits.
          </span>
        </div>
        {err && (
          <div className="err" role="alert" style={{ marginTop: 10 }}>
            {err}
          </div>
        )}
        <button type="submit" className="btn p" style={{ marginTop: 16 }} disabled={busy} aria-busy={busy}>
          <Icon name="plus" />
          Create team
        </button>
      </form>
    </div>
  );
}
