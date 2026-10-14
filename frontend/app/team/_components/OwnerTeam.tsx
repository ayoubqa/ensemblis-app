"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar, Icon, Modal, useToast } from "@/components";
import { api, type TeamDetail, type TeamInviteInfo, type TeamMemberInfo } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { toastApiError } from "@/lib/errors";
import { dateTime, dayLabel, eur, longDate, num, plural, relativeTime } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { SectionHead, TEAM_NAME_MAX, copyText, inviteUrl, teamNameError } from "./teamShared";

/** Owner view: rename, members, invite links, balance, dissolve. */
export function OwnerTeam({ team, setTeam }: { team: TeamDetail; setTeam: (t: TeamDetail | null) => void }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const objectivesThisMonth = team.members.reduce((n, m) => n + (m.objectivesThisMonth || 0), 0);
  const memberCount = team.members.length;

  // ---------- rename ----------
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [savingName, setSavingName] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameErr = teamNameError(name);
  useEffect(() => {
    if (editing) nameRef.current?.select();
  }, [editing]);

  const saveName = async (e?: FormEvent) => {
    e?.preventDefault();
    if (nameErr) return;
    if (name.trim() === team.name) {
      setEditing(false);
      return;
    }
    setSavingName(true);
    try {
      const r = await api.renameTeam(name.trim());
      setTeam(r.team);
      setUser((u) => (u && u.team ? { ...u, team: { ...u.team, name: r.team.name } } : u));
      setEditing(false);
      toast("Organization renamed", { icon: "check" });
    } catch (err) {
      toastApiError(toast, err, "Couldn't rename the organization");
    } finally {
      setSavingName(false);
    }
  };

  // ---------- members ----------
  const [removing, setRemoving] = useState<TeamMemberInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const removeMember = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      const r = await api.removeMember(removing.userId);
      setTeam(r.team);
      toast(`${removing.name} was removed from ${r.team.name}`);
      setRemoving(null);
    } catch (err) {
      toastApiError(toast, err, "Couldn't remove this member");
    } finally {
      setBusy(false);
    }
  };

  // ---------- invites ----------
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null); // id of the invite just created
  const [revoking, setRevoking] = useState<TeamInviteInfo | null>(null);
  const createInvite = async () => {
    setCreating(true);
    try {
      const { invite } = await api.createInvite();
      setTeam({ ...team, invites: [invite, ...team.invites.filter((i) => i.id !== invite.id)] });
      setFresh(invite.id);
      const ok = await copyText(inviteUrl(invite.token));
      toast(ok ? "Invite link created and copied" : "Invite link created", { icon: "link" });
    } catch (err) {
      toastApiError(toast, err, "Couldn't create an invite link");
    } finally {
      setCreating(false);
    }
  };
  const copyInvite = async (inv: TeamInviteInfo) => {
    const ok = await copyText(inviteUrl(inv.token));
    if (ok) toast("Invite link copied", { icon: "copy" });
    else toast.error("Couldn't access the clipboard — select the link and copy it manually.");
  };
  const revokeInvite = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.revokeInvite(revoking.id);
      setTeam({ ...team, invites: team.invites.filter((i) => i.id !== revoking.id) });
      toast("Invite link revoked — it no longer works");
      setRevoking(null);
    } catch (err) {
      toastApiError(toast, err, "Couldn't revoke this invite");
    } finally {
      setBusy(false);
    }
  };

  // ---------- dissolve ----------
  const [dissolveOpen, setDissolveOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const confirmOk = confirmText.trim() === team.name.trim();
  const dissolve = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirmOk) return;
    setBusy(true);
    try {
      const r = await api.deleteTeam();
      setUser(r.user);
      setDissolveOpen(false);
      toast(`${team.name} was dissolved`);
      setTeam(null);
    } catch (err) {
      toastApiError(toast, err, "Couldn't dissolve the organization");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap op-page">
      {/* Head + inline rename */}
      <div className="pagehead sh-ph">
        <div className="sh-ph-main">
          <div className="eyebrow">Organization members</div>
          {editing ? (
            <form className="op-inline" style={{ alignItems: "flex-start" }} onSubmit={saveName}>
              <div style={{ flex: "1 1 260px", maxWidth: 460 }}>
                <label htmlFor="rename-team" className="sr-only">
                  Organization name
                </label>
                <input
                  id="rename-team"
                  ref={nameRef}
                  className="f"
                  value={name}
                  maxLength={TEAM_NAME_MAX}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setName(team.name);
                      setEditing(false);
                    }
                  }}
                  aria-invalid={!!nameErr}
                  aria-describedby={nameErr ? "rename-err" : undefined}
                  style={{ fontSize: 20, fontWeight: 600 }}
                />
                {nameErr && (
                  <div className="err" id="rename-err" role="alert">
                    {nameErr}
                  </div>
                )}
              </div>
              <button type="submit" className="btn p" disabled={savingName || !!nameErr} aria-busy={savingName}>
                Save
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setName(team.name);
                  setEditing(false);
                }}
                disabled={savingName}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="op-headrow">
              <h1>{team.name}</h1>
              <button
                type="button"
                className="ibtn"
                onClick={() => {
                  setName(team.name);
                  setEditing(true);
                }}
                aria-label="Rename organization"
                title="Rename organization"
              >
                <Icon name="edit" />
              </button>
            </div>
          )}
          <p className="sh-ph-desc">
            You own this organization (created {longDate(team.createdAt)}). Members share its Company Context, Memory, objectives, AI Team and balance; you
            decide who&apos;s in and what needs approval.
          </p>
        </div>
      </div>

      {/* At a glance */}
      <div className="op-glance c3" aria-label="Organization at a glance">
        <div className="op-kpi is-accent">
          <span className="op-kpi-l">
            <Icon name="wallet" />
            Organization balance
          </span>
          <span className="op-kpi-v">{eur(team.walletCents)}</span>
          <span className="op-kpi-m">Your balance, shared with {plural(Math.max(0, memberCount - 1), "member")}</span>
          <span className="op-kpi-a">
            <Link className="op-link" href={ROUTES.usage}>
              Usage &amp; funds <Icon name="arrow" />
            </Link>
          </span>
        </div>
        <div className="op-kpi">
          <span className="op-kpi-l">
            <Icon name="users" />
            Members
          </span>
          <span className="op-kpi-v">{num(memberCount)}</span>
          <span className="op-kpi-m">including you · {plural(team.invites.length, "active invite")}</span>
        </div>
        <div className="op-kpi">
          <span className="op-kpi-l">
            <Icon name="target" />
            Objectives this month
          </span>
          <span className="op-kpi-v">{num(objectivesThisMonth)}</span>
          <span className="op-kpi-m">defined across the organization</span>
          <span className="op-kpi-a">
            <Link className="op-link" href={ROUTES.objectives}>
              View objectives <Icon name="arrow" />
            </Link>
          </span>
        </div>
      </div>

      {/* Members */}
      <section aria-labelledby="h-members">
        <SectionHead id="h-members" title="Members" sub="Removing someone ends their access to the organization. Objectives they defined stay." />
        <div className="tw op-members">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Joined</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Objectives this month
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {team.members.map((m) => {
                const me = m.userId === user?.id;
                return (
                  <tr key={m.userId}>
                    <td className="op-m-who">
                      <div className="op-person">
                        <Avatar name={m.name} size="sm" round />
                        <b>
                          {m.name}
                          {me && <span className="muted" style={{ fontWeight: 500 }}> (you)</span>}
                        </b>
                      </div>
                    </td>
                    <td className="op-m-email op-email" title={m.email}>
                      {m.email || <span className="muted">—</span>}
                    </td>
                    <td className="op-m-role">{m.role === "OWNER" ? <span className="tag">Owner</span> : <span className="tag gray">Member</span>}</td>
                    <td className="op-m-joined op-meta" title={dateTime(m.joinedAt)}>
                      <span className="op-only-s">Joined </span>
                      {dayLabel(m.joinedAt)}
                    </td>
                    <td className="op-m-count" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {num(m.objectivesThisMonth)}
                    </td>
                    <td className="op-m-act" style={{ textAlign: "right" }}>
                      {m.role !== "OWNER" && !me && (
                        <button type="button" className="btn sm" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name} from the organization`}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {memberCount <= 1 && <p className="op-note">It&apos;s just you so far. Create an invite link below and send it to a colleague.</p>}
      </section>

      {/* Invites */}
      <section aria-labelledby="h-invites">
        <SectionHead
          id="h-invites"
          title="Invite links"
          sub="Anyone with an active link can join until it expires, is used up or you revoke it. Share links only with people you trust to define objectives and spend from your organization's balance."
          right={
            <button type="button" className="btn p" onClick={createInvite} disabled={creating} aria-busy={creating}>
              <Icon name="link" />
              Create invite link
            </button>
          }
        />
        {team.invites.length === 0 ? (
          <div className="op-panel op-quiet">
            <Icon name="link" />
            No active invite links. Create one and send it by email or chat — new members join with a single click.
          </div>
        ) : (
          <ul className="op-stack" style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {team.invites.map((inv) => {
              const url = inviteUrl(inv.token);
              const isFresh = inv.id === fresh;
              return (
                <li key={inv.id} className={isFresh ? "op-panel op-invite is-fresh" : "op-panel op-invite"}>
                  {isFresh && (
                    <div className="op-meta" style={{ color: "var(--accent)", fontWeight: 650, marginBottom: 8 }}>
                      New link — send it to your colleague
                    </div>
                  )}
                  <div className="op-inline">
                    <label htmlFor={`inv-${inv.id}`} className="sr-only">
                      Invite link
                    </label>
                    <input id={`inv-${inv.id}`} className="f" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" className="btn sm" onClick={() => copyInvite(inv)}>
                      <Icon name="copy" />
                      Copy
                    </button>
                    <button type="button" className="btn sm ghost" onClick={() => setRevoking(inv)} aria-label="Revoke this invite link">
                      <Icon name="x" />
                      Revoke
                    </button>
                  </div>
                  <div className="op-meta op-inline" style={{ gap: "4px 14px", marginTop: 10 }}>
                    <span>
                      <b style={{ color: "var(--ink)" }}>{num(inv.uses)}</b> of {num(inv.maxUses)} uses
                    </span>
                    <span title={dateTime(inv.expiresAt)}>Expires {relativeTime(inv.expiresAt)}</span>
                    <span>Created {relativeTime(inv.createdAt)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Danger zone */}
      <section aria-labelledby="h-danger">
        <SectionHead id="h-danger" title="Danger zone" />
        <div className="op-panel op-pad op-danger">
          <div className="op-danger-row">
            <div>
              <b>Dissolve this organization</b>
              <p>
                Everyone else leaves the organization, open invite links stop working and members can no longer spend from your balance. Your balance stays
                yours. This can&apos;t be undone.
              </p>
            </div>
            <button
              type="button"
              className="btn bad"
              onClick={() => {
                setConfirmText("");
                setDissolveOpen(true);
              }}
            >
              <Icon name="trash" />
              Dissolve organization
            </button>
          </div>
        </div>
      </section>

      {/* Modals */}
      <Modal open={!!removing} onClose={() => !busy && setRemoving(null)} title={`Remove ${removing?.name ?? "member"}?`} dismissible={!busy}>
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          They&apos;ll leave {team.name} straight away and can&apos;t spend from your balance anymore. Objectives they defined stay with the organization.
          You can invite them again later.
        </p>
        <div className="row wrapflex">
          <button type="button" className="btn" onClick={() => setRemoving(null)} disabled={busy} data-autofocus>
            Keep them
          </button>
          <button type="button" className="btn bad" onClick={removeMember} disabled={busy} aria-busy={busy}>
            Remove from organization
          </button>
        </div>
      </Modal>

      <Modal open={!!revoking} onClose={() => !busy && setRevoking(null)} title="Revoke this invite link?" dismissible={!busy}>
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          Anyone who has the link won&apos;t be able to join with it. People who already joined stay in the organization.
        </p>
        <div className="row wrapflex">
          <button type="button" className="btn" onClick={() => setRevoking(null)} disabled={busy} data-autofocus>
            Keep link
          </button>
          <button type="button" className="btn bad" onClick={revokeInvite} disabled={busy} aria-busy={busy}>
            Revoke link
          </button>
        </div>
      </Modal>

      <Modal open={dissolveOpen} onClose={() => !busy && setDissolveOpen(false)} title="Dissolve the organization?" dismissible={!busy}>
        <form onSubmit={dissolve}>
          <p className="muted small" style={{ margin: "6px 0 14px" }}>
            {plural(Math.max(0, memberCount - 1), "member")} will lose access to the organization&apos;s balance, objectives and context. This can&apos;t be undone.
          </p>
          <label className="l" htmlFor="dissolve-confirm">
            Type <b style={{ color: "var(--ink)" }}>{team.name}</b> to confirm
          </label>
          <input
            id="dissolve-confirm"
            className="f"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-autofocus
          />
          <div className="row wrapflex" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setDissolveOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn bad" disabled={!confirmOk || busy} aria-busy={busy}>
              <Icon name="trash" />
              Dissolve organization
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
