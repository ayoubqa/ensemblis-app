"use client";

import { useRef, type ReactNode } from "react";
import type { Depth } from "@/lib/api";
import { DEPTHS, DEPTH_INFO } from "./draft";

/** Focused / Standard / Deep as a keyboard-friendly radio group of chips. */
export function DepthPicker({
  value,
  onChange,
  disabled,
  showHint = true,
  id = "depth",
  allowed,
  note,
}: {
  value: Depth;
  onChange: (d: Depth) => void;
  disabled?: boolean;
  showHint?: boolean;
  id?: string;
  /** Depths the user may pick (e.g. guests: Focused only). Default: all. */
  allowed?: Depth[];
  /** Shown under the chips instead of the depth description (e.g. why some are locked). */
  note?: ReactNode;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const ok = (d: Depth) => !allowed || allowed.includes(d);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let step = 0;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") step = 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") step = -1;
    if (!step) return;
    e.preventDefault();
    for (let k = 1; k <= DEPTHS.length; k++) {
      const n = (i + step * k + DEPTHS.length * 2) % DEPTHS.length;
      if (!ok(DEPTHS[n])) continue;
      onChange(DEPTHS[n]);
      refs.current[n]?.focus();
      return;
    }
  };
  return (
    <div>
      <div className="row wrapflex" style={{ gap: 8 }} role="radiogroup" aria-labelledby={`${id}-label`}>
        {DEPTHS.map((d, i) => {
          const on = d === value;
          const locked = !ok(d);
          return (
            <button
              key={d}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              disabled={disabled || locked}
              className={on ? "chip on" : "chip"}
              style={locked ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
              onClick={() => !locked && onChange(d)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {DEPTH_INFO[d].label}
              <span style={{ opacity: 0.7, fontWeight: 500, fontSize: 12 }}>{DEPTH_INFO[d].mult}</span>
            </button>
          );
        })}
      </div>
      {note ? (
        <div className="tiny muted" style={{ marginTop: 8 }}>
          {note}
        </div>
      ) : (
        showHint && (
          <div className="tiny muted" style={{ marginTop: 8 }} aria-live="polite">
            {DEPTH_INFO[value].desc}
          </div>
        )
      )}
    </div>
  );
}
