"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { api, type AgentDetail, type Depth, type TaskEstimate } from "@/lib/api";
import { Avatar, CharCount, Icon, VerifiedTag } from "@/components";
import { useConfig } from "@/lib/config";
import { TASK_TYPES } from "@/lib/data";
import { eur, minutesRange } from "@/lib/format";
import { useDebounced, useKeyboardShortcut } from "@/lib/hooks";
import { DepthPicker } from "./DepthPicker";

const CHAIN = ["Understand", "Plan", "Match", "Execute", "Verify", "Deliver"];
const PLACEHOLDER =
  "Analyze the top 20 competitors in the European data center cooling market and create a comparison of their products, pricing, positioning, and target customers.";

export function Describe({
  description,
  onDescription,
  depth,
  onDepth,
  agentId,
  direct,
  directLoading,
  onClearDirect,
  onSubmit,
}: {
  description: string;
  onDescription: (v: string) => void;
  depth: Depth;
  onDepth: (d: Depth) => void;
  agentId: string | null;
  direct: AgentDetail | null;
  directLoading: boolean;
  onClearDirect: () => void;
  onSubmit: () => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { config } = useConfig();
  const maxLen = config.maxDescriptionLength;

  // Live routing hint: a debounced, free estimate while the user types.
  const debounced = useDebounced(description.trim(), 650);
  const [hint, setHint] = useState<{ key: string; est: TaskEstimate } | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const hintKey = `${debounced}|${depth}|${agentId ?? ""}`;
  useEffect(() => {
    if (debounced.length < 12) {
      setHint(null);
      return;
    }
    let live = true;
    setHintBusy(true);
    api
      .estimateTask({ description: debounced, depth, agentId: agentId ?? undefined })
      .then(({ estimate }) => live && setHint({ key: hintKey, est: estimate }))
      .catch(() => live && setHint(null))
      .finally(() => live && setHintBusy(false));
    return () => {
      live = false;
    };
  }, [debounced, depth, agentId, hintKey]);

  useEffect(() => {
    // Focus the brief on arrival (desktop); keep the caret at the end of a prefill.
    const el = taRef.current;
    if (!el || window.matchMedia("(max-width: 860px)").matches) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const submit = () => {
    if (description.trim().length < 3) {
      setError("Describe the work you need done — a sentence or two is enough.");
      taRef.current?.focus();
      return;
    }
    if (description.length > maxLen) {
      setError(`Please shorten your brief to ${maxLen.toLocaleString("en")} characters or fewer.`);
      taRef.current?.focus();
      return;
    }
    setError(null);
    onSubmit();
  };
  useKeyboardShortcut("mod+enter", submit, { allowInInputs: true });

  const pickType = (text: string) => {
    onDescription(text);
    setError(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(text.length, text.length);
      }
    });
  };

  const est = hint && hint.key === hintKey ? hint.est : null;

  return (
    <div className="wrap">
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "44px 0 24px" }}>
        <h1 className="newh">What do you need done?</h1>
        <p className="muted" style={{ marginTop: 12, maxWidth: "54ch", fontSize: 17 }}>
          Describe the work in your own words. Ensemblis plans it, assembles the right team of AI agents, checks the result, and
          delivers it.
        </p>

        {(direct || directLoading) && (
          <div style={{ marginTop: 14 }} className="row wrapflex">
            {direct ? (
              <>
                <span className="row" style={{ gap: 8 }}>
                  <Avatar name={direct.name} hue={direct.hue} size="xs" />
                  <span className="small">
                    Working with <b>{direct.name}</b>
                  </span>
                  <VerifiedTag verified={direct.verified} compact />
                </span>
                <button type="button" className="chip on" onClick={onClearDirect} aria-label={`Stop working with ${direct.name}`}>
                  Let Ensemblis choose <Icon name="x" />
                </button>
              </>
            ) : (
              <span className="sk" style={{ width: 240, height: 26, display: "inline-block" }} />
            )}
          </div>
        )}

        <div className="brief" style={{ marginTop: 24 }}>
          <label htmlFor="draft">Your task</label>
          <textarea
            id="draft"
            ref={taRef}
            rows={4}
            value={description}
            maxLength={maxLen}
            placeholder={PLACEHOLDER}
            aria-invalid={error || description.length > maxLen ? true : undefined}
            aria-describedby="route-hint draft-count"
            onChange={(e) => {
              onDescription(e.target.value);
              if (error) setError(null);
            }}
          />
          <div className="foot">
            <div className="route" id="route-hint" aria-live="polite">
              <span className="pulse" />
              {!description.trim() ? (
                <span>Describe the work in plain language. Ensemblis plans the rest.</span>
              ) : est ? (
                <span>
                  Ensemblis will treat this as <b>{est.category}</b> · about <b>{eur(est.costCents)}</b> ·{" "}
                  {minutesRange(est.estMinutesLow, est.estMinutesHigh)} · {est.team.length} {est.team.length === 1 ? "agent" : "agents"}
                </span>
              ) : (
                <span>{hintBusy || description.trim().length >= 12 ? "Reading your brief…" : "Keep going: what outcome do you need?"}</span>
              )}
            </div>
            <button type="button" className="btn p lg" onClick={submit}>
              Analyze task <Icon name="arrow" />
            </button>
          </div>
        </div>
        {error && (
          <p className="err" role="alert" style={{ marginTop: 8 }}>
            {error}
          </p>
        )}
        <div className="row between" style={{ marginTop: 8 }}>
          <CharCount id="draft-count" value={description} max={maxLen} />
          <span className="tiny muted hideS">
            Press <span className="kbd">⌘</span> <span className="kbd">Enter</span> to analyze
          </span>
        </div>

        <div style={{ marginTop: 22 }}>
          <div className="tiny muted" id="depth-label" style={{ marginBottom: 8 }}>
            Depth · how thorough the team should be
          </div>
          <DepthPicker value={depth} onChange={onDepth} />
        </div>

        <div className="tiny muted" style={{ margin: "22px 0 8px" }}>
          Suggested task types · optional. Ensemblis infers the category from what you write.
        </div>
        <div className="examples" style={{ marginTop: 0 }}>
          {TASK_TYPES.map((x) => (
            <button key={x.label} type="button" className={description === x.text ? "chip on" : "chip"} onClick={() => pickType(x.text)}>
              {x.label}
            </button>
          ))}
        </div>

        <div className="chain" style={{ marginTop: 34 }} aria-label="What happens next">
          {CHAIN.map((x, i) => (
            <Fragment key={x}>
              <span className="cchip">{x}</span>
              {i < CHAIN.length - 1 && <Icon name="arrow" />}
            </Fragment>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          You describe the outcome. Ensemblis handles every step in between.
        </p>
        <div className="small muted" style={{ marginTop: 16, display: "flex", gap: 7, alignItems: "flex-start" }}>
          <Icon name="lock" />
          <span>
            Your task description is sent to our AI provider ({config.aiProviderLabel}) to produce the result. It&apos;s never sold. Don&apos;t include confidential or other people&apos;s personal information.
          </span>
        </div>
      </div>
    </div>
  );
}
