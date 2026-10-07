// Canonical URL map. Header, footer, command palette and shortcuts link through this.

export const ROUTES = {
  home: "/",
  howItWorks: "/#how",
  dashboard: "/dashboard",
  objectives: "/objectives",
  newObjective: "/objectives/new",
  objective: (id: string) => `/objectives/${encodeURIComponent(id)}`,
  aiTeam: "/ai-team",
  context: "/context",
  memory: "/context#memory",
  approvals: "/approvals",
  exceptions: "/exceptions",
  usage: "/usage",
  routines: "/routines",
  settings: "/settings",
  profile: "/settings#profile",
  members: "/team", // organization members (team model)
  joinTeam: (token: string) => `/join/${encodeURIComponent(token)}`,
  legacyReport: (id: string) => `/tasks/${encodeURIComponent(id)}`,
  legacyReports: "/objectives?group=earlier",
  sharedReport: (token: string) => `/r/${encodeURIComponent(token)}`,
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  verifyEmail: "/verify-email",
  privacy: "/privacy",
  terms: "/terms",
  admin: "/admin",
} as const;

/** "/login?next=/objectives/abc" */
export function loginUrl(next?: string | null): string {
  return next && next !== "/" ? `${ROUTES.login}?next=${encodeURIComponent(next)}` : ROUTES.login;
}

export function signupUrl(next?: string | null): string {
  return next ? `${ROUTES.signup}?next=${encodeURIComponent(next)}` : ROUTES.signup;
}

/** Only allow same-site relative redirects from ?next= */
export function safeNext(next: string | null | undefined, fallback = ROUTES.dashboard as string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  // Browsers treat "\" like "/" and drop tabs/newlines, so "/\evil.com" or "/<tab>/evil.com" would still leave the site.
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
