"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Task, TaskStep } from "@/lib/api";
import { Avatar, Flow, Icon, StepStatusTag } from "@/components";
import { STAGES } from "@/lib/data";
import { duration, eur } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { cx } from "@/lib/utils";
import { CitedMarkdown } from "@/components/report";
import { Gathering, Materials, SourcesMini } from "./Gathering";
import { LiveStream } from "./LiveStream";
import { clock, costByStep, snippet, sortedSteps, stepSeconds, useNow } from "./shared";

/** What each role is instructed to do — rotated as the live "working on" line. */
const ROLE_PHRASES: Record<string, string[]> = {
  Research: ["Scoping the question", "Gathering facts and entities", "Structuring findings into tables", "Marking estimates and confidence levels"],
  Analysis: ["Reading the research notes", "Working through the core analysis", "Comparing the options", "Drafting recommendations"],
  Verification: ["Checking the key claims", "Cross-checking figures between steps", "Flagging anything unsupported"],
  Report: ["Outlining the deliverable", "Writing the executive summary", "Formatting tables and sections", "Adding verification notes"],
};
const FALLBACK_PHRASES = ["Working through the brief", "Building on the previous step", "Writing up the output"];
const VERIFY_ITEMS = ["Handoffs checked", "Data consistency checked", "Key claims reviewed", "Report quality checked"];
const DEFAULT_STEP_SECONDS = 50;

type FeedItem = { id: string; at: number; text: React.ReactNode };

function buildFeed(task: Task, steps: TaskStep[]): FeedItem[] {
  const out: FeedItem[] = [];
  const t0 = new Date(task.createdAt).getTime();
  out.push({
    id: "plan",
    at: t0,
    text: (
      <>
        Plan approved: <b>{steps.length}</b> {steps.length === 1 ? "agent" : "agents"}, {task.depth} depth, {eur(task.costCents)}
      </>
    ),
  });
  if (task.startedAt) {
    out.push({
      id: "team",
      at: new Date(task.startedAt).getTime() + 1,
      text: <>Team assembled: {steps.map((s) => s.agentName).join(" → ")}</>,
    });
  }
  const nSources = (task.sources ?? []).length;
  if (nSources > 0) {
    const firstStart = steps.find((s) => s.startedAt)?.startedAt;
    out.push({
      id: "sources",
      at: firstStart ? new Date(firstStart).getTime() - 1 : (task.startedAt ? new Date(task.startedAt).getTime() : t0) + 2,
      text: (
        <>
          Research desk gathered <b>{nSources}</b> {nSources === 1 ? "source" : "sources"} for the team
        </>
      ),
    });
  }
  steps.forEach((s, i) => {
    if (s.startedAt) {
      out.push({
        id: `${s.id}-start`,
        at: new Date(s.startedAt).getTime() + 2,
        text:
          i === 0 ? (
            <>
              <b>{s.agentName}</b> picked up the brief: {s.title.toLowerCase()}
            </>
          ) : (
            <>
              Handoff → <b>{s.agentName}</b>: {s.title.toLowerCase()}
            </>
          ),
      });
    }
    if (s.completedAt && s.status === "COMPLETED") {
      const sec = stepSeconds(s);
      const snip = snippet(s.output);
      out.push({
        id: `${s.id}-done`,
        at: new Date(s.completedAt).getTime() + 3,
        text: (
          <>
            <b>{s.agentName}</b> finished {s.role.toLowerCase()} in {duration(sec)}
            {snip && <span className="muted"> · “{snip}”</span>}
          </>
        ),
      });
    }
    if (s.status === "FAILED") {
      out.push({
        id: `${s.id}-fail`,
        at: new Date(s.completedAt ?? s.startedAt ?? task.createdAt).getTime() + 3,
        text: (
          <>
            <b>{s.agentName}</b> hit a problem. Stopping the run and refunding.
          </>
        ),
      });
    }
  });
  return out.sort((a, b) => b.at - a.at);
}

function stageIndex(task: Task, running: TaskStep | undefined, last: TaskStep | undefined) {
  if (task.status === "PLANNING") return 2;
  if (running && (running.role === "Verification" || running.id === last?.id)) return 4;
  return 3;
}

export function RunView({ task, stale }: { task: Task; stale: boolean }) {
  const now = useNow(1000);
  const steps = useMemo(() => sortedSteps(task), [task]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const n = steps.length;
  const done = steps.filter((s) => s.status === "COMPLETED");
  const running = steps.find((s) => s.status === "RUNNING");
  const last = steps[n - 1];
  const durations = done.map((s) => stepSeconds(s)).filter((x): x is number => x !== null && x > 0);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : DEFAULT_STEP_SECONDS;
  const runSec = running ? stepSeconds(running, now) ?? 0 : 0;
  const partial = running ? Math.min(0.92, runSec / Math.max(avg, 20)) : 0;
  const progress = n ? Math.max(3, Math.min(99, ((done.length + partial) / n) * 100)) : 3;
  const remaining = Math.max(0, (n - done.length - partial) * avg);
  const startIso = task.startedAt ?? task.createdAt;
  const elapsed = Math.max(0, (now - new Date(startIso).getTime()) / 1000);
  const stage = stageIndex(task, running, last);

  const phrases = (running && ROLE_PHRASES[running.role]) || FALLBACK_PHRASES;
  const phrase = phrases[Math.floor(runSec / 4) % phrases.length];
  const feed = useMemo(() => buildFeed(task, steps), [task, steps]);
  const costs = useMemo(() => costByStep(task), [task]);
  const lastRunning = !!running && running.id === last?.id;
  const verifyDone = lastRunning ? Math.min(VERIFY_ITEMS.length - 1, Math.floor(runSec / 7)) : 0;
  const hueOf = (s: TaskStep) => (s.agentId && s.agentId === task.agentId && task.agent ? task.agent.hue : undefined);
  const gathering = task.status === "RUNNING" && steps.length > 0 && steps.every((s) => !s.startedAt);
  const runningSteps = steps.filter((s) => s.status === "RUNNING");
  const sources = task.sources ?? [];
  const attachments = task.attachments ?? [];

  return (
    <div className="wrap">
      <Flow step={stage >= 4 ? 3 : 2} />
      <div className="grid" id="rg" style={{ gridTemplateColumns: "1.6fr 1fr", gap: 20, marginTop: 10, alignItems: "start" }}>
        <div className="stack" style={{ minWidth: 0 }}>
          <div className="card">
            <div className="row between wrapflex">
              <span className="tag ok">
                <span className="pulse" style={{ width: 7, height: 7 }} />
                Ensemblis is working
              </span>
              <span className="row" style={{ gap: 6 }}>
                {stale && (
                  <span className="tag warn" title="We'll keep retrying">
                    Reconnecting…
                  </span>
                )}
                <span className="tag gray">
                  {task.depth.charAt(0).toUpperCase() + task.depth.slice(1)} depth
                </span>
              </span>
            </div>
            <h2 className="serif" style={{ fontSize: "clamp(24px,3.4vw,32px)", margin: "16px 0 4px", lineHeight: 1.1 }}>
              {task.title}
            </h2>
            <div className="muted small" aria-live="polite">
              {running ? (
                <>
                  <b style={{ color: "var(--ink)" }}>{running.agentName}</b> · {phrase}…<span className="caret" aria-hidden="true" />
                </>
              ) : task.status === "PLANNING" ? (
                "Assembling your team…"
              ) : gathering ? (
                <>
                  Gathering sources for the team…<span className="caret" aria-hidden="true" />
                </>
              ) : (
                "Handing off to the next agent…"
              )}
            </div>

            <div className="stagebar" style={{ marginTop: 18 }} aria-label="Stages">
              {STAGES.map((s, i) => (
                <div key={s} className={cx("stg", i < stage && "done", i === stage && "on")} aria-current={i === stage ? "step" : undefined}>
                  <i />
                  {s}
                </div>
              ))}
            </div>

            <div
              className="progress"
              style={{ marginTop: 18 }}
              role="progressbar"
              aria-label="Overall progress"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: `${progress}%`, transition: "width 1s linear" }} />
            </div>
            <div className="row between small muted" style={{ margin: "8px 0 4px" }}>
              <span>
                Elapsed <b style={{ color: "var(--ink)" }}>{duration(elapsed)}</b>
              </span>
              <span>
                {done.length} of {n} steps
              </span>
              <span>
                Remaining ~<b style={{ color: "var(--ink)" }}>{remaining < 60 ? "under a minute" : `${Math.ceil(remaining / 60)} min`}</b>
              </span>
            </div>

            {/* Live orchestration */}
            <div className="orch" aria-hidden="true">
              <div className="node d">
                <div className="row" style={{ gap: 6 }}>
                  <Icon name="check" />
                  <b>Your brief</b>
                </div>
                <div className="st" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {task.description}
                </div>
              </div>
              <div className={cx("conn", running?.order === steps[0]?.order && "act")} />
              <div className="agents">
                {steps.map((s, i) => {
                  const cls = s.status === "COMPLETED" ? "d" : s.status === "RUNNING" ? "w" : s.status === "FAILED" ? "" : "q";
                  return (
                    <div key={s.id} className={cx("node", cls)} style={s.status === "FAILED" ? { borderColor: "var(--bad)" } : undefined}>
                      <div className="row" style={{ gap: 6 }}>
                        {s.status === "COMPLETED" ? (
                          <Icon name="check" />
                        ) : s.status === "RUNNING" ? (
                          <span className="pulse" />
                        ) : (
                          <span className="tiny muted">0{i + 1}</span>
                        )}
                        <b>{s.agentName}</b>
                      </div>
                      <div className="st">
                        {s.role} · {s.status === "COMPLETED" ? `done in ${duration(stepSeconds(s))}` : s.status === "RUNNING" ? `working ${duration(runSec)}` : s.status === "FAILED" ? "failed" : "queued"}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={cx("conn", lastRunning && "act")} />
              <div className="node out q">
                <b>Your deliverable</b>
                <div className="st">{task.agent?.outputType ?? "Report"} · verified, then delivered here</div>
              </div>
            </div>

            {lastRunning && (
              <div className="verify reveal">
                <div className="eyebrow">VERIFYING YOUR RESULT</div>
                <ul className="chk">
                  {VERIFY_ITEMS.map((x, i) => (
                    <li key={x} className={i < verifyDone ? "done" : i === verifyDone ? "doing" : ""}>
                      <span className="ic">
                        <Icon name="check" />
                      </span>
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {gathering && <Gathering task={task} />}

          {runningSteps.map((s) => (
            <LiveStream key={s.id} task={task} step={s} now={now} phrase={phrase} hue={hueOf(s)} />
          ))}

          {/* Step log with peekable outputs */}
          <div className="card">
            <div className="row between">
              <b className="small">Work log</b>
              <span className="tiny muted">{runningSteps.length ? "Live output above · peek at finished steps" : "Open a finished step to read its output"}</span>
            </div>
            <ul className="chk" style={{ marginTop: 6 }}>
              {steps.map((s) => {
                const sec = stepSeconds(s, now);
                const isOpen = !!open[s.id];
                return (
                  <li
                    key={s.id}
                    className={s.status === "COMPLETED" ? "done" : s.status === "RUNNING" ? "doing" : ""}
                    style={{ flexWrap: "wrap", ...(s.status === "FAILED" ? { color: "var(--bad)" } : {}) }}
                  >
                    <span className="ic">
                      <Icon name={s.status === "FAILED" ? "x" : "check"} />
                    </span>
                    <span className="sp" style={{ minWidth: 0 }}>
                      <b>{s.agentName}</b> <span className="muted">· {s.title}</span>
                    </span>
                    <span className="stt tiny">
                      {s.status === "COMPLETED"
                        ? `Complete · ${duration(sec)}`
                        : s.status === "RUNNING"
                          ? `In progress · ${duration(sec)}`
                          : s.status === "FAILED"
                            ? "Failed"
                            : "Pending"}
                    </span>
                    {s.status === "COMPLETED" && s.output && (
                      <button
                        type="button"
                        className="btn sm ghost"
                        aria-expanded={isOpen}
                        aria-controls={`out-${s.id}`}
                        onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
                      >
                        <Icon name={isOpen ? "up" : "down"} />
                        {isOpen ? "Hide" : "Peek"}
                      </button>
                    )}
                    {isOpen && s.output && (
                      <div
                        id={`out-${s.id}`}
                        className="reveal"
                        style={{
                          flexBasis: "100%",
                          marginLeft: 34,
                          marginTop: 8,
                          maxHeight: 360,
                          overflow: "auto",
                          padding: "4px 16px",
                          border: "1px solid var(--line)",
                          borderRadius: 10,
                          background: "var(--surface2)",
                          color: "var(--ink)",
                        }}
                      >
                        <CitedMarkdown small sources={sources}>
                          {s.output}
                        </CitedMarkdown>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <details className="card det">
            <summary>Execution details</summary>
            <div className="tw" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Step</th>
                    <th>Status</th>
                    <th>Time</th>
                    <th>Cost share</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.steps.map(({ step: s, cents }) => (
                    <tr key={s.id}>
                      <td>
                        <b>{s.agentName}</b>
                      </td>
                      <td>
                        {s.role}: {s.title}
                      </td>
                      <td>
                        <StepStatusTag status={s.status} />
                      </td>
                      <td>{s.startedAt ? duration(stepSeconds(s, now)) : "—"}</td>
                      <td>{eur(cents)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} className="muted">
                      Ensemblis platform fee (included)
                    </td>
                    <td>{eur(costs.fee)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Cost share is an illustrative split of the {eur(task.costCents)} price by step role.
            </p>
          </details>
        </div>

        <div className="stack" style={{ minWidth: 0 }}>
          <div className="card">
            <b className="small">Your team</b>
            <div style={{ marginTop: 6 }}>
              {steps.map((s) => (
                <div key={s.id} className="lane">
                  <Avatar name={s.agentName} hue={hueOf(s)} size="sm" />
                  <div className="sp" style={{ minWidth: 0 }}>
                    <b className="small">{s.agentName}</b>
                    <div className="tiny muted">
                      {s.role} · {s.title}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <StepStatusTag status={s.status} />
                    <div className="tlog" style={{ marginTop: 4, marginRight: 0 }}>
                      {s.startedAt ? duration(stepSeconds(s, now)) : "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {attachments.length > 0 && (
            <div className="card">
              <b className="small">Your materials</b>
              <p className="tiny muted" style={{ margin: "2px 0 10px" }}>
                Shared with every agent on this task.
              </p>
              <Materials attachments={attachments} />
            </div>
          )}
          {!gathering && <SourcesMini sources={sources} />}
          <div className="card">
            <div className="row between">
              <b className="small">Live activity</b>
              <span className="tiny muted row" style={{ gap: 6 }}>
                <span className="pulse" />
                Live
              </span>
            </div>
            <div className="small" style={{ marginTop: 10, minHeight: 120 }} role="log" aria-live="polite" aria-relevant="additions">
              {feed.map((f) => (
                <div key={f.id} className="reveal" style={{ padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
                  <span className="tlog">{clock(f.at)}</span>
                  {f.text}
                </div>
              ))}
            </div>
          </div>
          <div className="card flat tight small">
            <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <Icon name="shield" />
              <span>Covered by the outcome guarantee: if any step fails, the full {eur(task.costCents)} returns to your credits automatically.</span>
            </div>
            <div className="row" style={{ gap: 8, alignItems: "flex-start", marginTop: 10 }}>
              <Icon name="bell" />
              <span>
                You can leave this page. The work continues and the bell lets you know when it&apos;s ready. Find it any time in{" "}
                <Link href={ROUTES.tasks} style={{ color: "var(--accent)", fontWeight: 600 }}>
                  My work
                </Link>
                .
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
