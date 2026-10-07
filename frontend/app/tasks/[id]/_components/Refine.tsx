"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { api, ApiError, type Task } from "@/lib/api";
import { CharCount, Icon, Mark, Skeleton, useToast } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { toastApiError } from "@/lib/errors";
import { duration, eur, num, relativeTime } from "@/lib/format";
import { useKeyboardShortcut } from "@/lib/hooks";
import { ROUTES, signupUrl } from "@/lib/routes";
import { cx } from "@/lib/utils";
import { short, useNow, type Version } from "./shared";
import R from "./refine.module.css";

const SUGGESTIONS = ["Make it shorter", "Add a comparison table", "Focus on Spain", "Explain the methodology"];
const MAX = 1000;

const wordsIn = (md: string | null) => (md ? (md.match(/\S+/g) || []).length : 0);

/** Version chips above the report (v1 Original, v2 "Make it shorter" …). */
export function VersionBar({
  versions,
  viewing,
  latest,
  onView,
}: {
  versions: Version[];
  viewing: number;
  latest: number;
  onView: (v: number) => void;
}) {
  if (versions.length < 2) return null;
  return (
    <>
      <div className={R.versions} role="group" aria-label="Report versions">
        <span className="tiny muted" style={{ fontWeight: 600, marginRight: 2 }}>
          Versions
        </span>
        {versions.map((v) => {
          const on = v.version === viewing;
          const viewable = v.status === "COMPLETED" && !!v.result;
          return (
            <button
              key={v.id}
              type="button"
              className={cx("chip", on && "on")}
              aria-pressed={on}
              disabled={!viewable}
              title={v.status === "RUNNING" ? `Writing: ${v.instruction}` : v.status === "FAILED" ? `Failed: ${v.instruction}` : v.instruction}
              onClick={() => viewable && onView(v.version)}
              style={!viewable ? { opacity: 0.7, cursor: v.status === "RUNNING" ? "progress" : "not-allowed" } : undefined}
            >
              {v.status === "RUNNING" ? <span className="spin" aria-hidden="true" /> : v.status === "FAILED" ? <Icon name="x" size={13} /> : null}
              <span className={R.verN}>v{v.version}</span>
              <span className={R.verLabel}>{v.version === 1 ? "Original" : `“${short(v.instruction, 26)}”`}</span>
              {v.version === latest && v.status === "COMPLETED" && versions.length > 1 && <span className="sr-only">(latest)</span>}
            </button>
          );
        })}
      </div>
      {viewing !== latest && (
        <div className="notice reveal" style={{ background: "var(--accent-soft)", color: "var(--accent)", marginBottom: 12 }}>
          <Icon name="info" />
          <span>
            You&apos;re viewing version {viewing}. Exports and copies use this version.{" "}
            <button type="button" onClick={() => onView(latest)} style={{ fontWeight: 700, textDecoration: "underline" }}>
              Back to latest (v{latest})
            </button>
          </span>
        </div>
      )}
    </>
  );
}

/** "Refine this report": chat-like follow-ups that create new versions. */
export function RefinePanel({
  task,
  versions,
  viewing,
  onView,
  onTask,
}: {
  task: Task;
  versions: Version[];
  viewing: number;
  onView: (v: number) => void;
  onTask: (t: Task) => void;
}) {
  const { user, setUser } = useAuth();
  const { config } = useConfig();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [short402, setShort402] = useState<string | null>(null);
  const inputId = useId();
  const cost = config.followupCostCents;
  const followups = versions.filter((v) => v.version > 1);
  const pending = followups.find((v) => v.status === "RUNNING");
  const now = useNow(1000, !!pending);
  const guest = !!user?.isGuest;
  const balance = user?.credits ?? 0;
  const insufficient = !!user && !guest && cost > 0 && balance < cost;
  const trimmed = text.trim();
  const canSend = !busy && !pending && !insufficient && trimmed.length >= 3 && trimmed.length <= MAX;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setShort402(null);
    try {
      const r = await api.createRevision(task.id, trimmed);
      setUser(r.user);
      onTask(r.task);
      setText("");
      toast("Refining your report. The new version appears here when it's ready.", { icon: "redo" });
    } catch (err) {
      const ae = err as ApiError;
      if (ae instanceof ApiError && ae.status === 402) setShort402(ae.message);
      else toastApiError(toast, err, "Couldn't start the refinement");
    } finally {
      setBusy(false);
    }
  };

  useKeyboardShortcut("mod+enter", () => submit(), { allowInInputs: true, enabled: canSend });

  return (
    <section className={cx("card", R.refine)} id="refine" aria-labelledby="refine-h">
      <div className="row between wrapflex" style={{ gap: 10 }}>
        <div>
          <h3 id="refine-h" className="row" style={{ gap: 8 }}>
            <Icon name="edit" />
            Refine this report
          </h3>
          <p className="small muted" style={{ marginTop: 4, maxWidth: "60ch" }}>
            Ask for changes in plain words. The team writes a new version; earlier versions stay one click away.
          </p>
        </div>
        {!guest && cost > 0 && <span className="tag gray">{eur(cost)} per refinement</span>}
      </div>

      {followups.length > 0 && (
        <div className={R.thread} role="log" aria-label="Refinement history" aria-live="polite">
          {followups.map((v) => (
            <div key={v.id} style={{ display: "contents" }}>
              <div className={R.msgUser}>
                <div className={R.bubble}>{v.instruction}</div>
                <div className={R.msgMeta}>
                  You · {relativeTime(v.createdAt)} · v{v.version}
                </div>
              </div>
              <div className={R.msgAgent}>
                <span className={R.agentMark} aria-hidden="true">
                  <Mark size={16} />
                </span>
                {v.status === "RUNNING" ? (
                  <div className={cx(R.reply, R.pending)}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="pulse" />
                      <b>Writing version {v.version}…</b>
                      <span className="tiny muted" style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
                        {v.createdAt ? duration(Math.max(0, (now - new Date(v.createdAt).getTime()) / 1000)) : ""}
                      </span>
                    </div>
                    <div className={R.bars} aria-hidden="true">
                      <Skeleton height={9} width="88%" />
                      <Skeleton height={9} width="64%" />
                    </div>
                    <p className="tiny muted" style={{ marginTop: 8 }}>
                      Usually about a minute. You can keep reading the current version meanwhile.
                    </p>
                  </div>
                ) : v.status === "FAILED" ? (
                  <div className={cx(R.reply, R.replyBad)} role="status">
                    <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                      <Icon name="alert" style={{ marginTop: 2 }} />
                      <div>
                        <b>Couldn&apos;t apply this change.</b>
                        {v.errorMessage && <div className="small" style={{ marginTop: 2, wordBreak: "break-word" }}>{v.errorMessage}</div>}
                        <div className="small" style={{ marginTop: 4, fontWeight: 600 }}>
                          {v.costCents > 0 ? `${eur(v.costCents)} refunded to your credits.` : "You weren't charged."}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={cx(R.reply, R.replyOk)}>
                    <Icon name="check" style={{ color: "var(--ok)" }} />
                    <span>
                      <b>Version {v.version} is ready</b>
                      <span className="muted small"> · {num(wordsIn(v.result))} words</span>
                    </span>
                    {viewing === v.version ? (
                      <span className="tag ok" style={{ marginLeft: "auto" }}>
                        Viewing
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn sm"
                        style={{ marginLeft: "auto" }}
                        onClick={() => {
                          onView(v.version);
                          const top = document.getElementById("report-top") ?? document.getElementById("main");
                          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                          top?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
                        }}
                      >
                        View v{v.version}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {guest ? (
        <div className="notice" style={{ marginTop: 16, background: "var(--accent-soft)", color: "var(--accent)", alignItems: "center", flexWrap: "wrap" }}>
          <Icon name="user" />
          <span className="sp" style={{ minWidth: 200 }}>
            <b>Create a free account to refine reports.</b> Your trial tasks come with you.
          </span>
          <Link className="btn p sm" href={signupUrl("company", ROUTES.task(task.id))}>
            Create free account
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className={R.suggest} role="group" aria-label="Suggestions">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={cx("chip", trimmed === s && "on")}
                disabled={!!pending}
                onClick={() => {
                  setText(s);
                  requestAnimationFrame(() => document.getElementById(inputId)?.focus());
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <div className={R.composer}>
            <label htmlFor={inputId} className="sr-only">
              Describe the change you want
            </label>
            <textarea
              id={inputId}
              rows={2}
              value={text}
              maxLength={MAX + 200}
              placeholder={pending ? `Version ${pending.version} is being written…` : "e.g. Add a section comparing prices in Germany and France"}
              disabled={!!pending || busy}
              aria-invalid={trimmed.length > MAX ? true : undefined}
              aria-describedby={`${inputId}-hint`}
              onChange={(e) => setText(e.target.value)}
            />
            <div className={R.composerFoot}>
              <CharCount value={text} max={MAX} />
              <button type="submit" className="btn p" disabled={!canSend} aria-busy={busy}>
                <Icon name="redo" />
                {cost > 0 ? `Refine · ${eur(cost)}` : "Refine"}
              </button>
            </div>
          </div>
          <p id={`${inputId}-hint`} className="tiny muted" style={{ marginTop: 8 }}>
            {pending
              ? `One refinement at a time: this box unlocks when version ${pending.version} is ready.`
              : `Each refinement ${cost > 0 ? `costs ${eur(cost)} and ` : ""}creates a new version from the latest one. If it fails, you're refunded automatically. Press ⌘/Ctrl + Enter to send.`}
          </p>
          {(insufficient || short402) && (
            <div className="notice" style={{ marginTop: 10 }}>
              <Icon name="wallet" />
              <span>
                {short402 ?? `A refinement costs ${eur(cost)}, but you have ${eur(balance)} left.`}{" "}
                <Link href={ROUTES.billing} style={{ fontWeight: 700, textDecoration: "underline" }}>
                  Add credits
                </Link>
              </span>
            </div>
          )}
        </form>
      )}
    </section>
  );
}
