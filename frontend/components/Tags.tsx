"use client";

import type { ReactNode } from "react";
import type { Outcome, TaskStatus, TaskStep } from "@/lib/api";
import { Icon, type IconName } from "./Icon";

export type TagVariant = "accent" | "ok" | "warn" | "bad" | "gray";

/** `.tag` pill. variant accent = default violet. */
export function Tag({ variant = "accent", icon, children, title, className }: { variant?: TagVariant; icon?: IconName; children: ReactNode; title?: string; className?: string }) {
  const cls = ["tag", variant !== "accent" && variant, className].filter(Boolean).join(" ");
  return (
    <span className={cls} title={title}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

/** Prototype `ver()`: verified → green shield "Verified"; otherwise amber "Identity verified". */
export function VerifiedTag({ verified, compact }: { verified: boolean; compact?: boolean }) {
  if (compact) {
    return verified ? (
      <span style={{ color: "var(--ok)", display: "inline-flex" }} title="Verified">
        <Icon name="shield" label="Verified" />
      </span>
    ) : null;
  }
  return verified ? (
    <span className="tag ok" title="Identity, capabilities and history verified">
      <Icon name="shield" />
      Verified
    </span>
  ) : (
    <span className="tag warn" title="Identity verified; capabilities still under review">
      Identity verified
    </span>
  );
}

const TASK_STATUS: Record<TaskStatus, { label: string; variant: TagVariant; live?: boolean }> = {
  PLANNING: { label: "Planning", variant: "accent", live: true },
  RUNNING: { label: "Running", variant: "accent", live: true },
  COMPLETED: { label: "Completed", variant: "ok" },
  FAILED: { label: "Failed", variant: "bad" },
  REFUNDED: { label: "Refunded", variant: "gray" },
};

export function taskStatusLabel(s: TaskStatus): string {
  return TASK_STATUS[s]?.label ?? s;
}

/** Task status → tag (running/planning get a live pulse). */
export function StatusTag({ status, label }: { status: TaskStatus; label?: string }) {
  const m = TASK_STATUS[status] ?? { label: status, variant: "gray" as TagVariant };
  return (
    <span className={["tag", m.variant !== "accent" && m.variant].filter(Boolean).join(" ")}>
      {m.live && <span className="pulse" aria-hidden="true" />}
      {label ?? m.label}
    </span>
  );
}

const STEP_STATUS: Record<TaskStep["status"], { label: string; variant: TagVariant }> = {
  QUEUED: { label: "Queued", variant: "gray" },
  RUNNING: { label: "Working", variant: "accent" },
  COMPLETED: { label: "Done", variant: "ok" },
  FAILED: { label: "Failed", variant: "bad" },
};

/** Task step status → tag ("Queued" / "Working" / "Done" / "Failed"), as in the run lanes. */
export function StepStatusTag({ status }: { status: TaskStep["status"] }) {
  const m = STEP_STATUS[status];
  return <Tag variant={m.variant}>{m.label}</Tag>;
}

/** Outcome feedback → tag. null renders a muted dash. */
export function OutcomeTag({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return <span className="muted">—</span>;
  const v: TagVariant = outcome === "Achieved" ? "ok" : outcome === "Partially" ? "warn" : "bad";
  return <Tag variant={v}>{outcome}</Tag>;
}

/** Compact read-only rating: ★ 4.8 (optionally "/5"). */
export function Rating({ value, outOf, className }: { value: number; outOf?: boolean; className?: string }) {
  return (
    <span className={className ? `rating ${className}` : "rating"} aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      <Icon name="star" />
      {value.toFixed(1)}
      {outOf && <span className="muted" style={{ fontWeight: 500 }}>/5</span>}
    </span>
  );
}

/**
 * Five-star input (`.stars`) — pass `onChange` to make it interactive,
 * omit it for a read-only display.
 */
export function Stars({ value, onChange, label = "Rating" }: { value: number; onChange?: (n: number) => void; label?: string }) {
  if (!onChange) {
    const full = Math.round(value);
    return (
      <span className="stars ro" role="img" aria-label={`${value} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= full ? "on" : ""} aria-hidden="true">
            ★
          </span>
        ))}
      </span>
    );
  }
  return (
    <div className="stars" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={value >= n ? "on" : ""}
          onClick={() => onChange(n)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              onChange(Math.min(5, (value || 0) + 1));
            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              onChange(Math.max(1, (value || 1) - 1));
            }
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
}
