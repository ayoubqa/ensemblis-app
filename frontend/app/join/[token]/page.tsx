"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar, Icon, useToast } from "@/components";
import { claimUrl } from "@/components/GuestBanner";
import { api, ApiError, type InvitePreview } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorText, toastApiError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { ROUTES, loginUrl, signupUrl } from "@/lib/routes";
import { AuthHead, AuthLoading, AuthNotice, AuthShell, FormError } from "../../login/_components/AuthUI";

const REASONS: Record<string, { title: string; body: string }> = {
  expired: { title: "This invite link has expired", body: "Invite links only work for a limited time." },
  revoked: { title: "This invite link was revoked", body: "The organization owner turned this link off." },
  "used up": { title: "This invite link has been used up", body: "It already reached its maximum number of members." },
};

export default function JoinPage() {
  const params = useParams<{ token: string }>();
  const token = safeDecode(typeof params?.token === "string" ? params.token : "");
  const router = useRouter();
  const toast = useToast();
  const { user, loading, setUser } = useAuth();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const here = ROUTES.joinTeam(token);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.previewInvite(token);
      setInvite(r.invite);
    } catch (e) {
      setError({ status: e instanceof ApiError ? e.status : 0, message: errorText(e, "Couldn't check this invite link.") });
    }
  }, [token]);
  useEffect(() => {
    if (token) load();
    else setError({ status: 404, message: "This invite link is incomplete." });
  }, [token, load]);

  const join = async () => {
    setJoining(true);
    setJoinError(null);
    try {
      const r = await api.joinTeam(token);
      setUser(r.user);
      toast(`Welcome to ${r.team.name}!`, { icon: "check" });
      router.push(ROUTES.dashboard);
    } catch (e) {
      toastApiError(toast, e, "Couldn't join this organization");
      setJoinError(errorText(e, "Couldn't join this organization. Please try again."));
      setJoining(false);
      load();
    }
  };

  const leave = (
    <Link className="btn" href={user ? ROUTES.dashboard : ROUTES.home}>
      {user ? "Open your workspace" : "Go to the home page"}
    </Link>
  );

  // ------------------------------------------------------------- states
  let body: React.ReactNode;
  if (error) {
    const notFound = error.status === 404 || error.status === 400;
    body = (
      <>
        <AuthHead
          tag={
            <span className="tag bad">
              <Icon name="alert" />
              {notFound ? "Invalid invite" : "Something went wrong"}
            </span>
          }
          title={notFound ? "We couldn't find this invite link" : "We couldn't check this invite"}
        >
          {notFound ? "Check that you copied the whole link, or ask the organization owner to send a new one." : error.message}
        </AuthHead>
        <div className="au-cta-row">
          {!notFound && (
            <button type="button" className="btn p" onClick={load}>
              <Icon name="redo" />
              Try again
            </button>
          )}
          {leave}
        </div>
      </>
    );
  } else if (!invite) {
    body = <AuthLoading label="Checking your invite…" lines={2} />;
  } else if (!invite.valid) {
    const r = REASONS[invite.reason ?? ""] ?? { title: "This invite link no longer works", body: invite.reason ? `Reason: ${invite.reason}.` : "" };
    body = (
      <>
        <AuthHead
          tag={
            <span className="tag warn">
              <Icon name="clock" />
              Invite unavailable
            </span>
          }
          title={r.title}
        >
          {r.body} Ask {invite.ownerName || "the organization owner"} for a new link to join <b>{invite.teamName}</b>.
        </AuthHead>
        <div className="au-cta-row">{leave}</div>
      </>
    );
  } else {
    const sameTeam = !!user?.team && user.team.name === invite.teamName;
    body = (
      <>
        <AuthHead
          tag={
            <span className="tag">
              <Icon name="users" />
              Organization invite
            </span>
          }
          title={`Join ${invite.teamName}`}
        >
          You&apos;ve been invited to work in this organization on Ensemblis.
        </AuthHead>
        <div className="au-invite">
          <Avatar name={invite.teamName} size="lg" />
          <div>
            <span className="au-invite-name">{invite.teamName}</span>
            <span className="au-invite-meta">
              Owner {invite.ownerName} · {plural(invite.memberCount, "member")}
            </span>
          </div>
        </div>
        <ul className="au-points">
          <li>
            <Icon name="building" />
            <span>You work from the organization&apos;s Company Context, objectives and AI Team.</span>
          </li>
          <li>
            <Icon name="wallet" />
            <span>Executions are paid from the organization&apos;s balance and follow its approval policy — {invite.ownerName} manages both.</span>
          </li>
          <li>
            <Icon name="out" />
            <span>You can leave any time.</span>
          </li>
        </ul>

        <div className="au-cta">
          {loading ? (
            <AuthLoading label="Checking your account…" lines={1} />
          ) : !user ? (
            <>
              <div className="au-cta-row">
                <Link className="btn p" href={loginUrl(here)}>
                  Log in to join
                </Link>
                <Link className="btn" href={signupUrl(here)}>
                  Create an account
                </Link>
              </div>
              <p className="au-fine">You&apos;ll come straight back here to accept the invite.</p>
            </>
          ) : user.isGuest ? (
            <>
              <AuthNotice>You&apos;re in a free trial. Create an account to join an organization. Your trial work comes with you.</AuthNotice>
              <div className="au-cta-row">
                <Link className="btn p" href={claimUrl(here)}>
                  <Icon name="check" />
                  Save your work and continue
                </Link>
              </div>
            </>
          ) : user.team ? (
            <>
              <AuthNotice tone={sameTeam ? "ok" : "neutral"} icon={sameTeam ? "check" : "info"}>
                {sameTeam ? (
                  <>You&apos;re already a member of {user.team.name}.</>
                ) : user.team.role === "OWNER" ? (
                  <>
                    You own <b>{user.team.name}</b>. You can be in one organization at a time — remove its members on your Members page before joining {invite.teamName}.
                  </>
                ) : (
                  <>
                    You&apos;re already in <b>{user.team.name}</b>. You can be in one organization at a time — leave it on your Members page before joining {invite.teamName}.
                  </>
                )}
              </AuthNotice>
              <div className="au-cta-row">
                <Link className="btn" href={ROUTES.members}>
                  Go to members
                </Link>
              </div>
            </>
          ) : (
            <>
              {joinError && <FormError>{joinError}</FormError>}
              <button type="button" className="btn p lg au-submit" onClick={join} disabled={joining} aria-busy={joining}>
                {joining ? "Joining…" : `Join ${invite.teamName}`}
                {!joining && <Icon name="arrow" />}
              </button>
              <p className="au-fine">
                Logged in as <b>{user.email}</b>.
              </p>
            </>
          )}
        </div>
      </>
    );
  }

  return <AuthShell>{body}</AuthShell>;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
