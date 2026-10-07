// Canonical URL map. Header, footer, command palette, bottom nav and shortcuts
// all link through this — page teams should build their pages at these paths
// (and use these helpers instead of hard-coding strings).

export const ROUTES = {
  home: "/",
  howItWorks: "/#how",
  newTask: "/new",
  tasks: "/tasks", // "My work" — task history
  task: (id: string) => `/tasks/${encodeURIComponent(id)}`,
  agents: "/agents",
  agent: (slugOrId: string) => `/agents/${encodeURIComponent(slugOrId)}`,
  dashboard: "/dashboard",
  workflows: "/workflows",
  workforce: "/workforce",
  billing: "/billing",
  settings: "/settings",
  profile: "/settings#profile",
  developers: "/developers", // public developer landing
  publish: "/developers/publish", // publish-an-agent wizard
  devDashboard: "/dashboard/developer",
  economics: "/economics",
  network: "/network",
  pricing: "/pricing",
  changelog: "/changelog",
  brand: "/brand",
  login: "/login",
  signup: "/signup",
  styleguide: "/styleguide",
  privacy: "/privacy",
  terms: "/terms",
  // v3
  examples: "/examples", // gallery of example reports
  example: (slug: string) => `/examples/${encodeURIComponent(slug)}`,
  sharedReport: (token: string) => `/r/${encodeURIComponent(token)}`,
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password", // ?token=…
  team: "/team",
  joinTeam: (token: string) => `/join/${encodeURIComponent(token)}`,
  admin: "/admin", // real owner dashboard for ADMIN_EMAILS; demo console otherwise
} as const;

/** "/login?next=/tasks/abc" */
export function loginUrl(next?: string | null): string {
  return next && next !== "/" ? `${ROUTES.login}?next=${encodeURIComponent(next)}` : ROUTES.login;
}

/** "/signup?type=company" (+ optional next) */
export function signupUrl(type?: "company" | "developer", next?: string | null): string {
  const q = new URLSearchParams();
  if (type) q.set("type", type);
  if (next) q.set("next", next);
  const s = q.toString();
  return s ? `${ROUTES.signup}?${s}` : ROUTES.signup;
}

/** Only allow same-site relative redirects from ?next= */
export function safeNext(next: string | null | undefined, fallback = ROUTES.dashboard as string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  // Browsers treat "\" like "/" and drop tabs/newlines, so "/\evil.com" or
  // "/<tab>/evil.com" would still leave the site.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
