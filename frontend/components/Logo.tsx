import Link from "next/link";

/** The Ensemblis "E" mark: a spine + three bars (prototype `mark()`). */
export function Mark({ size = 26, mono = false }: { size?: number; mono?: boolean }) {
  const A = mono ? "currentColor" : "var(--accent)";
  const B = mono ? "currentColor" : "var(--cyan)";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none" }}>
      <rect x="2" y="2" width="5" height="20" rx="2.2" fill="currentColor" />
      <rect x="10" y="2" width="12" height="5" rx="2.2" fill={A} />
      <rect x="10" y="9.5" width="8" height="5" rx="2.2" fill={B} opacity={mono ? 0.6 : undefined} />
      <rect x="10" y="17" width="12" height="5" rx="2.2" fill={A} opacity={mono ? 0.85 : undefined} />
    </svg>
  );
}

/** Mark + wordmark (prototype `lockup(sz)`). */
export function Lockup({ size = 26, mono = false, className }: { size?: number; mono?: boolean; className?: string }) {
  return (
    <span className={className ? `lockup ${className}` : "lockup"} style={{ gap: Math.round(size * 0.4) }}>
      <Mark size={size} mono={mono} />
      <span className="wm" style={{ fontSize: Math.round(size * 0.78) }}>
        Ensemblis
      </span>
    </span>
  );
}

/** Header logo: links home (`.logo` = mark 26 + 20px wordmark). */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="Ensemblis home">
      <Mark size={26} />
      <span className="wm">Ensemblis</span>
    </Link>
  );
}

export default Logo;
