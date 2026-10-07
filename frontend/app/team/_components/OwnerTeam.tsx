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

/** Owner view: rename, members, invite links, wallet, dissolve. */
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
      toast("Team renamed", { icon: "check" });
    } catch (err) {
      toastApiError(toast, err, "Couldn't rename the team");
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
      toastApiError(toast, err, "Couldn't dissolve the team");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ paddingBottom: 56 }}>
      {/* Head + inline rename */}
      <div className="pagehead">
        <div className="row wrapflex" style={{ gap: 8 }}>
          <span className="tag">
            <Icon name="share" />
            Team owner
          </span>
          <span className="tiny muted">Created {longDate(team.createdAt)}</span>
        </div>
        {editing ? (
          <form className="row wrapflex" style={{ gap: 8, marginTop: 12, alignItems: "flex-start" }} onSubmit={saveName}>
            <div style={{ flex: "1 1 260px", maxWidth: 460 }}>
              <label htmlFor="rename-team" className="sr-only">
                Team name
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
          <div className="row wrapflex" style={{ gap: 10, marginTop: 12 }}>
            <h1 style={{ margin: 0, overflowWrap: "anywhere" }}>{team.name}</h1>
            <button
              type="button"
              className="ibtn"
              onClick={() => {
                setName(team.name);
                setEditing(true);
              }}
              aria-label="Rename team"
              title="Rename team"
            >
              <Icon name="edit" />
            </button>
          </div>
        )}
        <p>Members share your organization&apos;s Company Context, objectives, AI Team and wallet. You decide who&apos;s in and what needs approval.</p>
      </div>

      {/* At a glance */}
      <div className="grid g3">
        <div className="card tight">
          <div className="eyebrow">ORGANIZATION WALLET</div>
          <b style={{ fontSize: 30, display: "block", letterSpacing: "-.02em" }}>{eur(team.walletCents)}</b>
          <div className="tiny muted" style={{ marginBottom: 10 }}>
            Your balance, shared with {plural(Math.max(0, memberCount - 1), "member")}
          </div>
          <Link className="btn sm p" href={ROUTES.usage}>
            <Icon name="plus" />
            Add balance
          </Link>
        </div>
        <div className="card tight">
          <div className="eyebrow">MEMBERS</div>
          <b style={{ fontSize: 30, display: "block", letterSpacing: "-.02em" }}>{num(memberCount)}</b>
          <div className="tiny muted">including you · {plural(team.invites.length, "active invite")}</div>
        </div>
        <div className="card tight">
          <div className="eyebrow">OBJECTIVES THIS MONTH</div>
          <b style={{ fontSize: 30, display: "block", letterSpacing: "-.02em" }}>{num(objectivesThisMonth)}</b>
          <div className="tiny muted" style={{ marginBottom: 10 }}>
            defined across the organization
          </div>
          <Link className="btn sm" href={ROUTES.objectives}>
            View objectives
          </Link>
        </div>
      </div>

      {/* Members */}
      <SectionHead id="h-members" title="Members" sub="Removing someone ends their access to the organization. Objectives they defined stay." />
      <div className="tw" aria-labelledby="h-members">
        <table style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
              <th style={{ textAlign: "right" }}>Objectives this month</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {team.members.map((m) => {
              const me = m.userId === user?.id;
              return (
                <tr key={m.userId}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <Avatar name={m.name} size="sm" round />
                      <b className="small">
                        {m.name}
                        {me && <span className="muted" style={{ fontWeight: 500 }}> (you)</span>}
                      </b>
                    </div>
                  </td>
                  <td className="small" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }} title={m.email}>
                    {m.email || <span className="muted">—</span>}
                  </td>
                  <td>{m.role === "OWNER" ? <span className="tag">Owner</span> : <span className="tag gray">Member</span>}</td>
                  <td className="small" title={dateTime(m.joinedAt)}>
                    {dayLabel(m.joinedAt)}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(m.objectivesThisMonth)}</td>
                  <td style={{ textAlign: "right" }}>
                    {m.role !== "OWNER" && !me && (
                      <button type="button" className="btn sm" onClick={() => setRemoving(m)} aria-label={`Remove ${m.name} from the team`}>
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
      {memberCount <= 1 && (
        <p className="small muted" style={{ marginTop: 10 }}>
          It&apos;s just you so far. Create an invite link below and send it to a colleague.
        </p>
      )}

      {/* Invites */}
      <SectionHead
        id="h-invites"
        title="Invite links"
        sub="Anyone with an active link can join until it expires, is used up or you revoke it. Share links only with people you trust to run objectives on your organization's balance."
        right={
          <button type="button" className="btn p" onClick={createInvite} disabled={creating} aria-busy={creating}>
            <Icon name="link" />
            Create invite link
          </button>
        }
      />
      {team.invites.length === 0 ? (
        <div className="card tight">
          <p className="small muted" style={{ margin: 0 }}>
            No active invite links. Create one and send it by email or chat — new members join with a single click.
          </p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }} aria-labelledby="h-invites">
          {team.invites.map((inv) => {
            const url = inviteUrl(inv.token);
            const isFresh = inv.id === fresh;
            return (
              <div
                key={inv.id}
                className="card tight"
                style={isFresh ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" } : undefined}
              >
                {isFresh && (
                  <div className="tiny" style={{ color: "var(--accent)", fontWeight: 700, marginBottom: 6 }}>
                    New link — send it to your colleague
                  </div>
                )}
                <div className="row wrapflex" style={{ gap: 8 }}>
                  <label htmlFor={`inv-${inv.id}`} className="sr-only">
                    Invite link
                  </label>
                  <input
                    id={`inv-${inv.id}`}
                    className="f"
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{ flex: "1 1 260px", minWidth: 0, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13 }}
                  />
                  <button type="button" className="btn sm" onClick={() => copyInvite(inv)}>
                    <Icon name="copy" />
                    Copy
                  </button>
                  <button type="button" className="btn sm ghost" onClick={() => setRevoking(inv)} aria-label="Revoke this invite link">
                    <Icon name="x" />
                    Revoke
                  </button>
                </div>
                <div className="tiny muted row wrapflex" style={{ gap: 12, marginTop: 8 }}>
                  <span>
                    <b style={{ color: "var(--ink)" }}>{num(inv.uses)}</b> of {num(inv.maxUses)} uses
                  </span>
                  <span title={dateTime(inv.expiresAt)}>Expires {relativeTime(inv.expiresAt)}</span>
                  <span>Created {relativeTime(inv.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Danger zone */}
      <SectionHead id="h-danger" title="Danger zone" />
      <div className="card" style={{ borderColor: "color-mix(in srgb, var(--bad) 45%, var(--line))" }} aria-labelledby="h-danger">
        <div className="row between wrapflex" style={{ gap: 12 }}>
          <div style={{ maxWidth: "62ch" }}>
            <b>Dissolve this team</b>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              Everyone leaves the team, open invite links stop working and members can no longer spend from your wallet. Your balance stays
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
            Dissolve team
          </button>
        </div>
      </div>

      {/* Modals */}
      <Modal open={!!removing} onClose={() => !busy && setRemoving(null)} title={`Remove ${removing?.name ?? "member"}?`} dismissible={!busy}>
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          They&apos;ll leave {team.name} straight away and can&apos;t spend from your wallet anymore. Objectives they defined stay with the organization.
          You can invite them again later.
        </p>
        <div className="row wrapflex">
          <button type="button" className="btn" onClick={() => setRemoving(null)} disabled={busy} data-autofocus>
            Keep them
          </button>
          <button type="button" className="btn bad" onClick={removeMember} disabled={busy} aria-busy={busy}>
            Remove from team
          </button>
        </div>
      </Modal>

      <Modal open={!!revoking} onClose={() => !busy && setRevoking(null)} title="Revoke this invite link?" dismissible={!busy}>
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          Anyone who has the link won&apos;t be able to join with it. People who already joined stay on the team.
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

      <Modal open={dissolveOpen} onClose={() => !busy && setDissolveOpen(false)} title="Dissolve the team?" dismissible={!busy}>
        <form onSubmit={dissolve}>
          <p className="muted small" style={{ margin: "6px 0 14px" }}>
            {plural(Math.max(0, memberCount - 1), "member")} will lose access to the organization&apos;s wallet, objectives and context. This can&apos;t be undone.
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
              Dissolve team
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
