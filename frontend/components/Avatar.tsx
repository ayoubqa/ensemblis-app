import type { CSSProperties } from "react";
import { initials } from "@/lib/format";
import { hueFrom } from "@/lib/utils";

export type AvatarSize = "xs" | "sm" | "md" | "lg";
const SIZES: Record<AvatarSize, CSSProperties> = {
  xs: { width: 26, height: 26, fontSize: 11, borderRadius: 8 },
  sm: { width: 32, height: 32, fontSize: 12, borderRadius: 9 },
  md: {},
  lg: {}, // .av.lg = 64px
};

export interface AvatarProps {
  /** Name the initials come from ("Competitive Intelligence Agent" → "CI"). */
  name: string;
  /** 0–360 hue (Agent.hue). Defaults to a stable hash of the name. */
  hue?: number;
  size?: AvatarSize;
  /** Circle instead of rounded square (people). */
  round?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Text label for screen readers; decorative by default. */
  label?: string;
}

/** Hue-tinted initials tile — prototype `av()` (`.av`, `--h`). Works in both themes via --avl/--avc. */
export function Avatar({ name, hue, size = "md", round, className, style, label }: AvatarProps) {
  const h = hue ?? hueFrom(name);
  const s = {
    "--h": h,
    ...SIZES[size],
    ...(round ? { borderRadius: "50%" } : null),
    ...style,
  } as CSSProperties;
  return (
    <div
      className={["av", size === "lg" && "lg", className].filter(Boolean).join(" ")}
      style={s}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {initials(name)}
    </div>
  );
}

/** Overlapping stack of round avatars (`.seatstack`). */
export function AvatarStack({ names, max = 3, hue = 250 }: { names: string[]; max?: number; hue?: number }) {
  return (
    <div className="seatstack" aria-label={`${names.length} people`}>
      {names.slice(0, max).map((n) => (
        <div key={n} className="av" style={{ "--h": hue } as CSSProperties} title={n}>
          {initials(n)}
        </div>
      ))}
      {names.length > max && <div className="av">+{names.length - max}</div>}
    </div>
  );
}

export default Avatar;
