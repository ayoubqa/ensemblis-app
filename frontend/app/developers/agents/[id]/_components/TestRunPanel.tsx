"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CharCount, Icon, ProgressBar, SkeletonText, StatusTag, useToast } from "@/components";
import { api, ApiError, type Agent, type Task } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { errorText, toastApiError } from "@/lib/errors";
import { durationBetween, num } from "@/lib/format";
import { usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { storage } from "@/lib/utils";

const TestMd = dynamic(() => import("./TestMd"), { ssr: false, loading: () => <SkeletonText lines={5} /> });

const MIN_BRIEF = 15;
const isActive = (t: Task) => t.status === "PLANNING" || t.status === "RUNNING";
const lastKey = (agentId: string) => `ens.testrun.${agentId}`;

/**
 * "Test your agent": a free single-agent run with the agent's current
 * instructions, limited to `perDay` runs per day. Shows live status and the
 * output inline; the full task view is one click away.
 */
export function TestRunPanel({
  agent,
  used,
  perDay,
  onUsed,
}: {
  agent: Pick<Agent, "id" | "name" | "taskType" | "specialty" | "isLive">;
  used: number;
  perDay: number;
  onUsed: (n: number) => void;
}) {
  const toast = useToast();
  const { config } = useConfig();
  const [brief, setBrief] = useState("");
  const [task, setTask] = useState<Task | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const left = Math.max(0, perDay - used);
  const max = config.maxDescriptionLength || 8000;
  const tooShort = brief.trim().length < MIN_BRIEF;
  const tooLong = brief.length > max;

  // Bring back the last test run for this agent after a reload.
  useEffect(() => {
    const id = storage.get(lastKey(agent.id));
    if (!id) return;
    let live = true;
    api.getTask(id).then(
      (r) => live && r.task.isTest && setTask(r.task),
      () => storage.set(lastKey(agent.id), null)
    );
    return () => {
      live = false;
    };
  }, [agent.id]);

  usePolling(
    async () => {
      if (!task) return false;
      const { task: t } = await api.getTask(task.id);
      setTask(t);
      if (t.status === "COMPLETED") toast(`Test run of ${agent.name} finished`, { icon: "check" });
      return isActive(t);
    },
    2500,
    { enabled: !!task && isActive(task), immediate: false }
  );

  const run = async () => {
    if (tooShort) {
      setErr(`Describe the test task in at least ${MIN_BRIEF} characters.`);
      return;
    }
    if (tooLong || left <= 0) return;
    setErr(null);
    setStarting(true);
    try {
      const { task: t } = await api.devTestRun(agent.id, brief.trim());
      setTask(t);
      storage.set(lastKey(agent.id), t.id);
      onUsed(used + 1);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) onUsed(perDay);
      setErr(errorText(e, "Couldn't start the test run"));
      toastApiError(toast, e, "Couldn't start the test run");
    } finally {
      setStarting(false);
    }
  };

  const steps = task?.steps ?? [];
  const done = steps.filter((s) => s.status === "COMPLETED").length;
  const runningStep = steps.find((s) => s.status === "RUNNING") ?? null;
  const progress = task ? (task.status === "COMPLETED" ? 100 : steps.length ? Math.max(6, Math.round(((done + (runningStep ? 0.5 : 0)) / steps.length) * 100)) : 6) : 0;
  const output = task?.result ?? [...steps].reverse().find((s) => s.output)?.output ?? null;
  const live = runningStep?.liveOutput ?? null;

  return (
    <section id="test-run" className="card" style={{ marginTop: 16, scrollMarginTop: 90 }} aria-labelledby="h-test-run">
      <div className="row between wrapflex" style={{ gap: 10 }}>
        <div>
          <h3 id="h-test-run" style={{ margin: 0 }}>
            Test your agent
          </h3>
          <p className="small muted" style={{ margin: "4px 0 0", maxWidth: "62ch" }}>
            Run a free task with {agent.name} alone, using its current instructions. Test runs aren&apos;t charged and don&apos;t count toward
            its stats or your revenue{agent.isLive ? "" : " — you can test while it's paused"}.
          </p>
        </div>
        <span className={left > 0 ? "tag gray" : "tag warn"} title="Test runs per day">
          <Icon name="zap" />
          {num(left)} of {num(perDay)} left today
        </span>
      </div>

      <form
        style={{ marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="l" htmlFor="test-brief">
          Test brief
        </label>
        <textarea
          id="test-brief"
          className="f"
          rows={3}
          value={brief}
          onChange={(e) => {
            setBrief(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void run();
            }
          }}
          placeholder={`e.g. A ${agent.taskType.toLowerCase()} for a 40-person coffee roaster expanding to Lisbon`}
          aria-invalid={!!err || tooLong}
          aria-describedby="test-brief-hint"
          disabled={starting}
        />
        <div className="row between wrapflex" style={{ gap: 8, marginTop: 6 }}>
          {err ? (
            <div className="err" id="test-brief-hint" role="alert" style={{ margin: 0 }}>
              {err}
            </div>
          ) : (
            <div className="hint" id="test-brief-hint" style={{ margin: 0 }}>
              Write it like a customer would. Good tests mirror real requests for {agent.specialty || agent.taskType}.
            </div>
          )}
          <CharCount value={brief} max={max} />
        </div>
        <div className="row wrapflex" style={{ marginTop: 12, gap: 10 }}>
          <button type="submit" className="btn p" disabled={starting || left <= 0 || tooLong || (!!task && isActive(task))} aria-busy={starting}>
            <Icon name="play" />
            {task && isActive(task) ? "Test running…" : "Run free test"}
          </button>
          {left <= 0 && <span className="small muted">You&apos;ve used today&apos;s test runs. More are available tomorrow.</span>}
        </div>
      </form>

      {task && (
        <div className="card flat tight" style={{ marginTop: 16 }} aria-live="polite">
          <div className="row between wrapflex" style={{ gap: 8 }}>
            <div className="row wrapflex" style={{ gap: 8, minWidth: 0 }}>
              <StatusTag status={task.status} />
              <span className="tag warn">Test run</span>
              <b className="small" style={{ overflowWrap: "anywhere" }}>
                {task.title}
              </b>
            </div>
            <Link className="btn sm" href={ROUTES.task(task.id)}>
              <Icon name="ext" />
              Open full view
            </Link>
          </div>

          {isActive(task) && (
            <div style={{ marginTop: 12 }}>
              <ProgressBar value={progress} label="Test run progress" />
              <div className="tiny muted" style={{ marginTop: 6 }}>
                {runningStep ? `Working: ${runningStep.title}` : task.status === "PLANNING" ? "Planning…" : "Starting…"} · {durationBetween(task.startedAt ?? task.createdAt)}
              </div>
              {live && (
                <div
                  className="small"
                  style={{ marginTop: 10, whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto", padding: 12, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--muted)" }}
                >
                  {live.length > 1200 ? "…" + live.slice(-1200) : live}
                  <span className="caret" aria-hidden="true" />
                </div>
              )}
            </div>
          )}

          {task.status === "COMPLETED" && (
            <div style={{ marginTop: 12 }}>
              <div className="tiny muted" style={{ marginBottom: 8 }}>
                Finished in {durationBetween(task.startedAt ?? task.createdAt, task.completedAt)}
              </div>
              {output ? (
                <div style={{ maxHeight: 460, overflow: "auto", padding: "4px 14px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--line)" }}>
                  <TestMd>{output}</TestMd>
                </div>
              ) : (
                <p className="small muted">The run finished without any output. Open the full view for details.</p>
              )}
              <p className="tiny muted" style={{ marginTop: 8 }}>
                AI-generated output — verify important facts before relying on them.
              </p>
            </div>
          )}

          {(task.status === "FAILED" || task.status === "REFUNDED") && (
            <div className="notice" role="alert" style={{ marginTop: 12, background: "var(--bad-soft)", color: "var(--bad)" }}>
              <Icon name="alert" />
              <span>
                {task.errorMessage || "The test run didn't complete."} Test runs are free, so nothing was charged. Adjust the instructions below and
                try again.
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
