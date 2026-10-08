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
  /** Name the initials come from ("Head of Sales" → "HS"). */
  name: string;
  /** 0–360 hue (e.g. an AI Team member's hue). Defaults to a stable hash of the name. Folded into the brand's blue range. */
  hue?: number;
  size?: AvatarSize;
  /** Circle instead of rounded square (people). */
  round?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Text label for screen readers; decorative by default. */
  label?: string;
}

/** Any hue folded into the navy → electric-blue band (196°–236°), so tiles stay on-brand but distinguishable. */
export const brandHue = (h: number) => Math.round(196 + ((((h % 360) + 360) % 360) / 360) * 40);

/** Initials tile (`.av`, `--h`). Works in both themes via --avl/--avc. */
export function Avatar({ name, hue, size = "md", round, className, style, label }: AvatarProps) {
  const h = brandHue(hue ?? hueFrom(name));
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

/** Overlapping stack of round avatars (`.seatstack`). Kept for compatibility; currently unused. */
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
