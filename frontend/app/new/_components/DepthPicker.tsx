"use client";

import { useRef } from "react";
import type { Depth } from "@/lib/api";
import { DEPTHS, DEPTH_INFO } from "./draft";

/** Focused / Standard / Deep as a keyboard-friendly radio group of chips. */
export function DepthPicker({
  value,
  onChange,
  disabled,
  showHint = true,
  id = "depth",
}: {
  value: Depth;
  onChange: (d: Depth) => void;
  disabled?: boolean;
  showHint?: boolean;
  id?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % DEPTHS.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + DEPTHS.length) % DEPTHS.length;
    if (n < 0) return;
    e.preventDefault();
    onChange(DEPTHS[n]);
    refs.current[n]?.focus();
  };
  return (
    <div>
      <div className="row wrapflex" style={{ gap: 8 }} role="radiogroup" aria-labelledby={`${id}-label`}>
        {DEPTHS.map((d, i) => {
          const on = d === value;
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
              disabled={disabled}
              className={on ? "chip on" : "chip"}
              onClick={() => onChange(d)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {DEPTH_INFO[d].label}
              <span style={{ opacity: 0.7, fontWeight: 500, fontSize: 12 }}>{DEPTH_INFO[d].mult}</span>
            </button>
          );
        })}
      </div>
      {showHint && (
        <div className="tiny muted" style={{ marginTop: 8 }} aria-live="polite">
          {DEPTH_INFO[value].desc}
        </div>
      )}
    </div>
  );
}
