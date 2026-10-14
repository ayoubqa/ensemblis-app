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

/** Member view: the organization, who's in it, and a way out. */
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
      toastApiError(toast, err, "Couldn't leave the organization");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap op-page">
      <div className="pagehead sh-ph">
        <div className="sh-ph-main">
          <div className="eyebrow">Organization members</div>
          <h1 style={{ overflowWrap: "anywhere" }}>{team.name}</h1>
          <p className="sh-ph-desc">
            Owned by <b style={{ color: "var(--ink)" }}>{team.owner.name}</b>
            {me ? ` · you joined ${longDate(me.joinedAt)}` : ""}. Executions you start are paid from the organization balance, and everyone in the
            organization can see the objectives.
          </p>
        </div>
      </div>

      <div className="op-glance c3" aria-label="Organization at a glance">
        <div className="op-kpi">
          <span className="op-kpi-l">
            <Icon name="wallet" />
            Organization balance
          </span>
          <span className="op-kpi-v">{eur(team.walletCents)}</span>
          <span className="op-kpi-m">Managed by {team.owner.name}. Ask them to add funds when it runs low.</span>
        </div>
        <div className="op-kpi">
          <span className="op-kpi-l">
            <Icon name="users" />
            Members
          </span>
          <span className="op-kpi-v">{num(team.members.length)}</span>
          <span className="op-kpi-m">including {team.owner.name} and you</span>
        </div>
        <div className="op-kpi">
          <span className="op-kpi-l">
            <Icon name="target" />
            Your objectives this month
          </span>
          <span className="op-kpi-v">{num(me?.objectivesThisMonth ?? 0)}</span>
          <span className="op-kpi-a">
            <Link className="op-link" href={ROUTES.objectives}>
              View objectives <Icon name="arrow" />
            </Link>
          </span>
        </div>
      </div>

      <section aria-labelledby="h-members">
        <SectionHead id="h-members" title="Members" />
        <ul className="op-panel" aria-label="Members">
          {team.members.map((m) => (
            <li key={m.userId} className="op-lane" style={{ alignItems: "center" }}>
              <Avatar name={m.name} size="sm" round />
              <div className="op-lane-b">
                <b>
                  {m.name}
                  {m.userId === user?.id && <span className="muted" style={{ fontWeight: 500 }}> (you)</span>}
                </b>
                <div className="op-meta" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.email ? `${m.email} · ` : ""}
                  <span title={dateTime(m.joinedAt)}>joined {dayLabel(m.joinedAt)}</span> · {plural(m.objectivesThisMonth, "objective")} this month
                </div>
              </div>
              {m.role === "OWNER" ? <span className="tag">Owner</span> : <span className="tag gray">Member</span>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-leave">
        <SectionHead id="h-leave" title="Leave the organization" />
        <div className="op-panel op-pad op-danger">
          <div className="op-danger-row">
            <p style={{ marginTop: 0 }}>
              You&apos;ll go back to your own organization and stop seeing this one&apos;s objectives. To rejoin later you&apos;ll need a new invite link from{" "}
              {team.owner.name}.
            </p>
            <button type="button" className="btn bad" onClick={() => setLeaving(true)}>
              <Icon name="out" />
              Leave organization
            </button>
          </div>
        </div>
      </section>

      <Modal open={leaving} onClose={() => !busy && setLeaving(false)} title={`Leave ${team.name}?`} dismissible={!busy}>
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          You&apos;ll stop spending from the organization balance and lose access to the organization&apos;s objectives and context. You&apos;ll need a new invite to come back.
        </p>
        <div className="row wrapflex">
          <button type="button" className="btn" onClick={() => setLeaving(false)} disabled={busy} data-autofocus>
            Stay
          </button>
          <button type="button" className="btn bad" onClick={leave} disabled={busy} aria-busy={busy}>
            Leave organization
          </button>
        </div>
      </Modal>
    </div>
  );
}
