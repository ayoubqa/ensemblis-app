"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components";
import { ORCH_AGENTS, STAGES } from "@/lib/data";
import { prefersReducedMotion } from "@/lib/utils";

type NodeState = "q" | "m" | "w" | "d" | "";
const LABEL: Record<Exclude<NodeState, "">, string> = { q: "Queued", m: "Matched", w: "Working", d: "Done" };

export interface OrchProps {
  stage?: number;
  done?: boolean;
  loop?: boolean;
  agents?: [string, string][];
  /** false hides the verification node; a tuple overrides its label. */
  ver?: false | [string, string];
  task?: string;
  out?: string;
  outd?: string;
}

function OrchNode({ name, desc, state, loop }: { name: string; desc: string; state: NodeState; loop?: boolean }) {
  return (
    <div className={`node ${state}`.trim()}>
      <div className="row between">
        <b>{name}</b>
        {state === "d" ? <Icon name="check" /> : state === "w" ? <span className="pulse" aria-hidden="true" /> : null}
      </div>
      <div className="tiny muted">{desc}</div>
      {state === "w" && (
        <div className="pb">
          <i />
        </div>
      )}
      {!loop && state && <div className="tiny st">{LABEL[state]}</div>}
    </div>
  );
}

/** Prototype `orch()`: task → specialists → verification → one outcome. */
export function Orch({ stage = 0, done = false, loop = false, agents = ORCH_AGENTS, ver, task, out, outd }: OrchProps) {
  const st = stage;
  const aS: NodeState = loop ? "" : st < 2 ? "q" : st === 2 ? "m" : st === 3 ? "w" : "d";
  const vS: NodeState = loop ? "" : st < 4 ? "q" : st === 4 ? "w" : "d";
  const oS: NodeState = loop ? "" : done ? "d" : "q";
  const verNode = ver === false ? null : ver || (["Verification Agent", "Checks sources and requirements"] as [string, string]);
  return (
    <div className={`orch ${loop ? "loop" : ""}`.trim()}>
      <div className="node">
        <div className="tiny muted">Task</div>
        <div className="small" style={{ fontWeight: 600 }}>
          {task || "Analyze the top 20 competitors in the European data center cooling market"}
        </div>
      </div>
      <div className={`conn ${loop || st >= 1 ? "act" : ""}`} />
      <div className="agents">
        {agents.map(([n, d]) => (
          <OrchNode key={n} name={n} desc={d} state={aS} loop={loop} />
        ))}
      </div>
      <div className={`conn ${loop || st >= 3 ? "act" : ""}`} />
      {verNode && (
        <>
          <OrchNode name={verNode[0]} desc={verNode[1]} state={vS} loop={loop} />
          <div className={`conn ${st >= 4 ? "act" : ""}`} />
        </>
      )}
      <div className={`node out ${oS}`.trim()}>
        <div className="row between">
          <b>{out || "One final outcome"}</b>
          {oS === "d" && <Icon name="check" />}
        </div>
        <div className="tiny muted">{outd || "A verified, finished deliverable"}</div>
      </div>
    </div>
  );
}

const SEQ = [700, 1000, 1100, 2800, 1600];
const NARRATION = [
  "Reading your brief…",
  "Working out what the task needs…",
  "Matching specialists by performance on similar work…",
  "Agents are working in coordination…",
  "Checking sources, figures and requirements…",
  "Done — one verified deliverable.",
];

/**
 * Prototype `demoHTML()` + `runDemo()`: a stage-by-stage preview of how a brief
 * would be orchestrated. Replayable, with optional auto-replay.
 */
export function DemoPanel({
  runId,
  task,
  agents,
  ver,
  summary,
  onRun,
  onReset,
}: {
  /** Changing this restarts the animation. */
  runId: number;
  task: string;
  agents?: [string, string][];
  ver?: false | [string, string];
  summary?: string;
  onRun: () => void;
  onReset: () => void;
}) {
  const [stage, setStage] = useState(0);
  const [done, setDone] = useState(false);
  const [loop, setLoop] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const [replays, setReplays] = useState(0);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const start = useCallback(() => {
    clear();
    setDone(false);
    setStage(0);
    if (prefersReducedMotion()) {
      setStage(5);
      setDone(true);
      return;
    }
    let at = 0;
    SEQ.forEach((ms, k) => {
      at += ms;
      timers.current.push(
        setTimeout(() => {
          setStage(k + 1);
          if (k + 1 >= 5) setDone(true);
        }, at)
      );
    });
  }, []);

  useEffect(() => {
    start();
    const el = panelRef.current;
    if (el && el.getBoundingClientRect().bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "nearest" });
    }
    return clear;
  }, [runId, replays, start]);

  // Auto-replay
  useEffect(() => {
    if (!loop || !done) return;
    const t = setTimeout(() => setReplays((r) => r + 1), 3200);
    return () => clearTimeout(t);
  }, [loop, done]);

  return (
    <div className="dpanel reveal" ref={panelRef}>
      <div className="stagebar" role="list" aria-label="Orchestration stages">
        {STAGES.map((x, i) => (
          <div key={x} role="listitem" className={`stg ${done || i < stage ? "done" : i === stage ? "on" : ""}`.trim()} aria-current={!done && i === stage ? "step" : undefined}>
            <i />
            <span>{x}</span>
          </div>
        ))}
      </div>
      <div className="row between wrapflex" style={{ marginTop: 14, gap: 10 }}>
        <span className="small muted" aria-live="polite" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!done && <span className="pulse" aria-hidden="true" />}
          {NARRATION[done ? 5 : stage]}
        </span>
        <label className="tiny muted row" style={{ gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          Auto-replay
        </label>
      </div>
      <Orch stage={stage} done={done} task={task} agents={agents} ver={ver} />
      {done && (
        <div className="ready reveal">
          <div>
            <b>Your work is ready.</b>
            <div className="small muted">{summary || "One deliverable · every claim checked · sources listed"}</div>
          </div>
          <div className="row wrapflex">
            <button type="button" className="btn p" onClick={onRun}>
              Run this task <Icon name="arrow" />
            </button>
            <button type="button" className="btn" onClick={() => setReplays((r) => r + 1)}>
              <Icon name="redo" />
              Replay
            </button>
            <button type="button" className="btn ghost" onClick={onReset}>
              Try another
            </button>
          </div>
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 12 }}>
        Preview only — timings are shortened. A real run takes minutes and is billed only when you start it.
      </p>
    </div>
  );
}
