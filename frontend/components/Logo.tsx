import Link from "next/link";
import type { CSSProperties } from "react";

// The official Ensemblis mark (Brand + Creative Web Pack: logo/ensemblis-official-logo-transparent.png),
// served from /public/brand as proportional resizes of that exact file. It is never redrawn,
// recoloured, outlined or recreated in CSS/SVG — see public/brand/README.md.
const SIZES = [32, 48, 64, 96, 128, 192, 256, 384] as const;
const fit = (px: number) => SIZES.find((s) => s >= px) ?? SIZES[SIZES.length - 1];
const file = (px: number, ext: "png" | "webp") => `/brand/ensemblis-mark-${fit(px)}.${ext}`;
const srcSet = (size: number, ext: "png" | "webp") => `${file(size, ext)} 1x, ${file(size * 2, ext)} 2x, ${file(size * 3, ext)} 3x`;

export const BRAND_MARK_PNG = "/brand/ensemblis-official-logo-transparent.png";

/**
 * The official mark. Decorative by default (the wordmark or a link label names it);
 * pass `label` when it stands alone.
 */
export function Mark({ size = 28, label, priority = false, style }: { size?: number; label?: string; priority?: boolean; style?: CSSProperties }) {
  return (
    <picture style={{ display: "inline-flex", flex: "none", width: size, height: size, ...style }}>
      <source type="image/webp" srcSet={srcSet(size, "webp")} />
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized static brand asset, not worth the image optimizer */}
      <img
        src={file(size, "png")}
        srcSet={srcSet(size, "png")}
        width={size}
        height={size}
        alt={label ?? ""}
        aria-hidden={label ? undefined : true}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        style={{ width: size, height: size, display: "block" }}
      />
    </picture>
  );
}

/** Mark + "ENSEMBLIS" wordmark (set in Inter, as on the official reference sheet). */
export function Lockup({ size = 28, className, priority }: { size?: number; className?: string; priority?: boolean }) {
  return (
    <span className={className ? `lockup ${className}` : "lockup"} style={{ gap: Math.round(size * 0.4) }}>
      <Mark size={size} priority={priority} />
      <span className="wm" style={{ fontSize: Math.max(12, Math.round(size * 0.52)) }}>
        Ensemblis
      </span>
    </span>
  );
}

/** Header logo: links home. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="Ensemblis home">
      <Mark size={30} priority />
      <span className="wm">Ensemblis</span>
    </Link>
  );
}

export default Logo;
