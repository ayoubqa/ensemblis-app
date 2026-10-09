"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components";
import { StageMark, type StageState } from "./Lifecycle";

/**
 * One chapter of the console story. Lifecycle stages carry their number and
 * state on the rail; the report and memory carry an icon instead.
 */
export function Stage({
  id,
  title,
  n = null,
  state,
  icon,
  meta,
  right,
  children,
}: {
  id: string;
  title: string;
  n?: number | null;
  state?: StageState;
  icon?: IconName;
  meta?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  const hid = `${id}-h`;
  return (
    <section id={id} className={`cs-stage${state ? ` is-${state}` : ""}`} aria-labelledby={hid}>
      <div className="cs-stage-head">
        {state ? (
          <StageMark state={state} n={n} />
        ) : (
          <span className="cs-mark is-icon cs-mark-md" aria-hidden="true">
            <Icon name={icon ?? "spark"} size={14} />
          </span>
        )}
        <div className="cs-stage-tt">
          <h2 id={hid}>{title}</h2>
          {meta && <span className="cs-stage-meta">{meta}</span>}
        </div>
        {right && <div className="cs-stage-right">{right}</div>}
      </div>
      <div className="cs-stage-body">{children}</div>
    </section>
  );
}
