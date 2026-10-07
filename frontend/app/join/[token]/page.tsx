"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar, Icon, Skeleton, SkeletonText, confetti, useToast } from "@/components";
import { api, ApiError, type InvitePreview } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorText, toastApiError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { ROUTES, loginUrl, signupUrl } from "@/lib/routes";

const REASONS: Record<string, { title: string; body: string }> = {
  expired: { title: "This invite link has expired", body: "Invite links only work for a limited time." },
  revoked: { title: "This invite link was revoked", body: "The team owner turned this link off." },
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
    try {
      const r = await api.joinTeam(token);
      setUser(r.user);
      confetti();
      toast(`Welcome to ${r.team.name}!`, { icon: "check" });
      router.push(ROUTES.team);
    } catch (e) {
      toastApiError(toast, e, "Couldn't join this team");
      setJoining(false);
      load();
    }
  };

  // ------------------------------------------------------------- states
  let body: React.ReactNode;
  if (error) {
    const notFound = error.status === 404 || error.status === 400;
    body = (
      <>
        <span className="tag bad">
          <Icon name="alert" />
          {notFound ? "Invalid invite" : "Something went wrong"}
        </span>
        <h1 className="serif" style={titleStyle}>
          {notFound ? "We couldn't find this invite link." : "We couldn't check this invite."}
        </h1>
        <p className="muted">
          {notFound ? "Check that you copied the whole link, or ask the team owner to send a new one." : error.message}
        </p>
        <div className="row wrapflex" style={{ marginTop: 18 }}>
          {!notFound && (
            <button type="button" className="btn p" onClick={load}>
              <Icon name="redo" />
              Try again
            </button>
          )}
          <Link className="btn" href={user ? ROUTES.dashboard : ROUTES.home}>
            {user ? "Go to my dashboard" : "Go to the home page"}
          </Link>
        </div>
      </>
    );
  } else if (!invite) {
    body = (
      <div aria-busy="true" aria-label="Checking your invite">
        <Skeleton width={110} height={22} />
        <Skeleton width="80%" height={34} style={{ marginTop: 14 }} />
        <div style={{ marginTop: 16 }}>
          <SkeletonText lines={3} />
        </div>
      </div>
    );
  } else if (!invite.valid) {
    const r = REASONS[invite.reason ?? ""] ?? { title: "This invite link no longer works", body: invite.reason ? `Reason: ${invite.reason}.` : "" };
    body = (
      <>
        <span className="tag warn">
          <Icon name="clock" />
          Invite unavailable
        </span>
        <h1 className="serif" style={titleStyle}>
          {r.title}
        </h1>
        <p className="muted">
          {r.body} Ask {invite.ownerName || "the team owner"} for a new link to join <b style={{ color: "var(--ink)" }}>{invite.teamName}</b>.
        </p>
        <div className="row wrapflex" style={{ marginTop: 18 }}>
          <Link className="btn" href={user ? ROUTES.dashboard : ROUTES.home}>
            {user ? "Go to my dashboard" : "Go to the home page"}
          </Link>
        </div>
      </>
    );
  } else {
    const sameTeam = !!user?.team && user.team.name === invite.teamName;
    body = (
      <>
        <span className="tag">
          <Icon name="share" />
          Team invite
        </span>
        <div className="row" style={{ gap: 14, marginTop: 16 }}>
          <Avatar name={invite.teamName} size="lg" />
          <div style={{ minWidth: 0 }}>
            <h1 className="serif" style={{ ...titleStyle, margin: 0, overflowWrap: "anywhere" }}>
              Join {invite.teamName}
            </h1>
            <div className="small muted">
              Owner {invite.ownerName} · {plural(invite.memberCount, "member")}
            </div>
          </div>
        </div>
        <ul className="small muted" style={{ margin: "18px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>Your tasks are paid from the team wallet — {invite.ownerName} manages the credits.</li>
          <li>Everyone on the team can see the tasks you run, and you can see theirs.</li>
          <li>You can leave the team any time.</li>
        </ul>

        <div style={{ marginTop: 22 }}>
          {loading ? (
            <Skeleton width={180} height={40} radius={10} />
          ) : !user ? (
            <>
              <div className="row wrapflex">
                <Link className="btn p" href={loginUrl(here)}>
                  Log in to join
                </Link>
                <Link className="btn" href={signupUrl("company", here)}>
                  Create a free account
                </Link>
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                You&apos;ll come straight back here to accept the invite.
              </p>
            </>
          ) : user.isGuest ? (
            <>
              <div className="notice" style={{ marginBottom: 12 }}>
                <Icon name="info" />
                <span>You&apos;re using a guest session. Create a free account to join a team — your guest work comes with you.</span>
              </div>
              <Link className="btn p" href={`${ROUTES.signup}?claim=1&next=${encodeURIComponent(here)}`}>
                <Icon name="check" />
                Save your work and continue
              </Link>
            </>
          ) : user.team ? (
            <>
              <div className="notice" style={sameTeam ? { background: "var(--ok-soft)", color: "var(--ok)" } : undefined}>
                <Icon name={sameTeam ? "check" : "info"} />
                <span>
                  {sameTeam ? (
                    <>You&apos;re already a member of {user.team.name}.</>
                  ) : user.team.role === "OWNER" ? (
                    <>
                      You own <b>{user.team.name}</b>. You can be in one team at a time — dissolve it on your Team page before joining{" "}
                      {invite.teamName}.
                    </>
                  ) : (
                    <>
                      You&apos;re already in <b>{user.team.name}</b>. You can be in one team at a time — leave it on your Team page before joining{" "}
                      {invite.teamName}.
                    </>
                  )}
                </span>
              </div>
              <Link className="btn" href={ROUTES.team} style={{ marginTop: 12 }}>
                Go to my team
              </Link>
            </>
          ) : (
            <>
              <button type="button" className="btn p lg" onClick={join} disabled={joining} aria-busy={joining}>
                Join {invite.teamName}
                <Icon name="arrow" />
              </button>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Signed in as {user.email}.
              </p>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="narrow" style={{ padding: "40px 24px 64px" }}>
      <div className="card" style={{ padding: "clamp(22px,4vw,36px)" }}>
        {body}
      </div>
    </div>
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const titleStyle: React.CSSProperties = { fontSize: "clamp(26px,3.6vw,36px)", lineHeight: 1.1, margin: "12px 0 8px", fontWeight: 500 };
