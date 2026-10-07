"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar, Icon, Modal, useToast } from "@/components";
import { api, type TeamDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { toastApiError } from "@/lib/errors";
import { dateTime, dayLabel, eur, longDate, num, plural } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { SectionHead } from "./teamShared";

/** Member view: team info, who's in it, and a way out. */
export function MemberTeam({ team, setTeam }: { team: TeamDetail; setTeam: (t: TeamDetail | null) => void }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = team.members.find((m) => m.userId === user?.id);

  const leave = async () => {
    setBusy(true);
    try {
      const r = await api.leaveTeam();
      setUser(r.user);
      setLeaving(false);
      toast(`You left ${team.name}`);
      setTeam(null);
    } catch (err) {
      toastApiError(toast, err, "Couldn't leave the team");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ paddingBottom: 56 }}>
      <div className="pagehead">
        <span className="tag gray">
          <Icon name="share" />
          Organization member
        </span>
        <h1 style={{ marginTop: 12, overflowWrap: "anywhere" }}>{team.name}</h1>
        <p>
          Owned by <b style={{ color: "var(--ink)" }}>{team.owner.name}</b>
          {me ? ` · you joined ${longDate(me.joinedAt)}` : ""}. Executions you start are paid from the organization wallet, and everyone in the organization can see the objectives.
        </p>
      </div>

      <div className="grid g3">
        <div className="card tight">
          <div className="eyebrow">ORGANIZATION WALLET</div>
          <b style={{ fontSize: 30, display: "block", letterSpacing: "-.02em" }}>{eur(team.walletCents)}</b>
          <div className="tiny muted">Managed by {team.owner.name}. Ask them to add balance when it runs low.</div>
        </div>
        <div className="card tight">
          <div className="eyebrow">MEMBERS</div>
          <b style={{ fontSize: 30, display: "block", letterSpacing: "-.02em" }}>{num(team.members.length)}</b>
          <div className="tiny muted">including {team.owner.name} and you</div>
        </div>
        <div className="card tight">
          <div className="eyebrow">YOUR OBJECTIVES THIS MONTH</div>
          <b style={{ fontSize: 30, display: "block", letterSpacing: "-.02em" }}>{num(me?.objectivesThisMonth ?? 0)}</b>
          <Link className="btn sm" href={ROUTES.objectives} style={{ marginTop: 10 }}>
            View objectives
          </Link>
        </div>
      </div>

      <SectionHead id="h-members" title="Members" />
      <div className="card tight" style={{ padding: "4px 16px" }} aria-labelledby="h-members">
        {team.members.map((m) => (
          <div key={m.userId} className="lane">
            <Avatar name={m.name} size="sm" round />
            <div className="sp" style={{ minWidth: 0 }}>
              <b className="small" style={{ display: "block" }}>
                {m.name}
                {m.userId === user?.id && <span className="muted" style={{ fontWeight: 500 }}> (you)</span>}
              </b>
              <div className="tiny muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {m.email ? `${m.email} · ` : ""}
                <span title={dateTime(m.joinedAt)}>joined {dayLabel(m.joinedAt)}</span> · {plural(m.objectivesThisMonth, "objective")} this month
              </div>
            </div>
            {m.role === "OWNER" ? <span className="tag">Owner</span> : <span className="tag gray hideS">Member</span>}
          </div>
        ))}
      </div>

      <SectionHead id="h-leave" title="Leave the team" />
      <div className="card" aria-labelledby="h-leave">
        <div className="row between wrapflex" style={{ gap: 12 }}>
          <p className="small muted" style={{ margin: 0, maxWidth: "62ch" }}>
            You&apos;ll go back to your own organization and stop seeing this one&apos;s objectives. To rejoin later you&apos;ll need a new invite link from{" "}
            {team.owner.name}.
          </p>
          <button type="button" className="btn bad" onClick={() => setLeaving(true)}>
            <Icon name="out" />
            Leave team
          </button>
        </div>
      </div>

      <Modal open={leaving} onClose={() => !busy && setLeaving(false)} title={`Leave ${team.name}?`} dismissible={!busy}>
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          You&apos;ll stop spending from the team wallet and lose access to the organization&apos;s objectives and context. You&apos;ll need a new invite to come back.
        </p>
        <div className="row wrapflex">
          <button type="button" className="btn" onClick={() => setLeaving(false)} disabled={busy} data-autofocus>
            Stay
          </button>
          <button type="button" className="btn bad" onClick={leave} disabled={busy} aria-busy={busy}>
            Leave team
          </button>
        </div>
      </Modal>
    </div>
  );
}
