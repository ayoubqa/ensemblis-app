"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Task, TaskStep } from "@/lib/api";
import { Avatar, Icon, Skeleton } from "@/components";
import { CitedMarkdown } from "@/components/report";
import { duration, num } from "@/lib/format";
import { useReducedMotion } from "@/lib/hooks";
import { cx } from "@/lib/utils";
import { stepSeconds } from "./shared";
import L from "./live.module.css";

const POLL_MS = 2000;
const TAIL_CHARS = 7000;

/**
 * Smoothly reveals `target` as it grows between polls: the new characters are
 * spread over roughly one poll interval, so text flows instead of jumping.
 */
export function useTypewriter(target: string, active: boolean): string {
  const reduce = useReducedMotion();
  // Start a little behind on first view so the stream is visibly alive.
  const shownRef = useRef(Math.max(0, target.length - 260));
  const [shown, setShown] = useState(shownRef.current);
  const prevTarget = useRef(target);
  const rate = useRef(0.04); // characters per ms

  useEffect(() => {
    const prev = prevTarget.current;
    prevTarget.current = target;
    const keep = Math.min(prev.length, Math.floor(shownRef.current));
    if (!target.startsWith(prev.slice(0, keep))) {
      // The text was replaced or trimmed at the front: stay the same distance from the end.
      const behind = Math.max(0, prev.length - shownRef.current);
      shownRef.current = Math.max(0, target.length - behind);
    }
    if (shownRef.current > target.length) shownRef.current = target.length;
    const remaining = target.length - shownRef.current;
    rate.current = Math.max(0.03, remaining / (POLL_MS - 150));
  }, [target]);

  useEffect(() => {
    if (reduce || !active) {
      shownRef.current = target.length;
      setShown(target.length);
      return;
    }
    let raf = 0;
    let last = performance.now();
    let committed = 0;
    const tick = (now: number) => {
      const dt = Math.min(120, now - last);
      last = now;
      if (shownRef.current < target.length) {
        shownRef.current = Math.min(target.length, shownRef.current + rate.current * dt);
        if (now - committed > 33 || shownRef.current >= target.length) {
          committed = now;
          setShown(Math.floor(shownRef.current));
        }
        raf = requestAnimationFrame(tick);
      } else setShown(target.length);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, reduce]);

  return target.slice(0, Math.min(target.length, Math.floor(shown)));
}

/** Last part of a long stream, cut at a paragraph boundary so markdown stays valid. */
function tailOf(text: string): { text: string; trimmed: boolean } {
  if (text.length <= TAIL_CHARS) return { text, trimmed: false };
  const from = text.length - TAIL_CHARS;
  const cut = text.indexOf("\n\n", from);
  return { text: text.slice(cut > -1 && cut < text.length - 200 ? cut + 2 : from), trimmed: true };
}

const WORKING: Record<string, string> = {
  Research: "is researching",
  Analysis: "is analysing",
  Verification: "is checking the work",
  Report: "is writing the report",
};

export function LiveStream({
  task,
  step,
  now,
  phrase,
  hue,
}: {
  task: Task;
  step: TaskStep;
  now: number;
  phrase: string;
  hue?: number;
}) {
  const target = step.liveOutput ?? "";
  const running = step.status === "RUNNING";
  const typed = useTypewriter(target, running);
  const { text, trimmed } = useMemo(() => tailOf(typed), [typed]);
  const words = useMemo(() => (target.match(/\S+/g) || []).length, [target]);
  const sources = task.sources ?? [];
  const [open, setOpen] = useState(true);
  const [detached, setDetached] = useState(false);
  const stick = useRef(true);
  const box = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const sec = stepSeconds(step, now) ?? 0;
  const catchingUp = typed.length < target.length;

  // Follow the newest text unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text, open]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    stick.current = atBottom;
    setDetached(!atBottom);
  };

  const toLatest = () => {
    const el = box.current;
    if (!el) return;
    stick.current = true;
    setDetached(false);
    el.scrollTop = el.scrollHeight;
  };

  return (
    <section className={cx("card", L.live)} aria-label={`Live output from ${step.agentName}`}>
      <div className={L.liveHead}>
        <div className={running ? L.ring : undefined}>
          <Avatar name={step.agentName} hue={hue} size="sm" />
        </div>
        <div className="sp" style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <b>{step.agentName}</b>
            <span className="muted small">{WORKING[step.role] ?? "is working"}</span>
          </div>
          <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Step {step.order + 1} · {step.title}
            {!target && ` · ${phrase}…`}
          </div>
        </div>
        <div className={L.liveStats}>
          <span className="tag ok">
            <span className="pulse" style={{ width: 7, height: 7 }} />
            Live
          </span>
          <span className="tiny muted" style={{ fontVariantNumeric: "tabular-nums" }}>
            {num(words)} {words === 1 ? "word" : "words"} · {duration(sec)}
          </span>
        </div>
        <button
          type="button"
          className="ibtn"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? "Hide live output" : "Show live output"}
          title={open ? "Hide live output" : "Show live output"}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name={open ? "up" : "down"} />
        </button>
      </div>

      {open && (
        <div className={L.streamWrap} id={bodyId}>
          <div ref={box} className={cx(L.stream, running && L.typing)} onScroll={onScroll} tabIndex={0} aria-label="Live output (updates as the agent writes)">
            {trimmed && <div className={L.trimmed}>… earlier output is in the final report</div>}
            {text ? (
              <CitedMarkdown small sources={sources}>
                {text}
              </CitedMarkdown>
            ) : (
              <div className={L.thinking} aria-live="polite">
                <div className="small muted row" style={{ gap: 8 }}>
                  <span className="spin" aria-hidden="true" />
                  {phrase}…
                </div>
                <Skeleton height={11} width="92%" />
                <Skeleton height={11} width="78%" />
                <Skeleton height={11} width="85%" />
              </div>
            )}
          </div>
          {detached && (
            <button type="button" className={L.jump} onClick={toLatest}>
              <Icon name="down" size={14} />
              {catchingUp ? "Follow the live text" : "Jump to latest"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
