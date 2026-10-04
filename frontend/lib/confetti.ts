// Prototype `confetti()` — 28 falling pieces in brand colours. No-op when the
// user prefers reduced motion or during SSR. Uses the `.confetti` CSS class.

export function confetti(opts: { count?: number } = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["var(--accent)", "var(--cyan)", "#F5A623", "var(--ok)"];
  const n = opts.count ?? 28;
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.className = "confetti";
    d.setAttribute("aria-hidden", "true");
    d.style.left = Math.random() * 100 + "vw";
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = 1.5 + Math.random() * 1.1 + "s";
    d.style.animationDelay = Math.random() * 0.22 + "s";
    d.style.opacity = String(0.85 + Math.random() * 0.15);
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3000);
  }
}

export default confetti;
