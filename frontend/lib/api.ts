// =====================================================================
// Ensemblis API contract — the single source of truth shared by the
// frontend and the backend. Every endpoint below is implemented in
// backend/src. Money is always integer cents (EUR). 1 credit = 1 cent.
// v3 adds: web research + citations, attachments, live output, follow-up
// revisions, clarifying questions, guest trial, sharing, gallery, email +
// password reset, owner dashboard, Stripe payments, teams, developer test runs.
// =====================================================================

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const TOKEN_KEY = "ensemblis_token";

// ---------- Types ----------

export type AccountType = "COMPANY" | "DEVELOPER";

export interface User {
  id: string;
  email: string;
  name: string;
  company: string | null;
  role: string | null;
  accountType: AccountType;
  builds: string | null;
  credits: number; // cents — the SPENDABLE balance: the team wallet (team owner's balance) when in a team
  createdAt: string;
  // v3
  isGuest: boolean; // "try without signing up" account; can be claimed with api.claimAccount
  isAdmin: boolean; // email listed in the server's ADMIN_EMAILS
  emailOnTaskDone: boolean;
  team: { id: string; name: string; role: TeamRole } | null;
  walletOwner: "self" | "team"; // whose balance `credits` shows
}

export type TeamRole = "OWNER" | "MEMBER";

export interface Agent {
  id: string;
  slug: string; // URL-safe, e.g. "competitive-intelligence-agent"
  name: string;
  category: string; // e.g. "Research", "Sales"
  creator: string; // publisher display name, e.g. "DataLabs"
  description: string;
  capabilities: string[];
  specialty: string; // "competitive intelligence and market research"
  taskType: string; // "Competitive Intelligence"
  outputType: string; // "PDF report"
  pricePerTaskCents: number; // typical price
  priceFromCents: number; // lowest price
  estMinutesLow: number;
  estMinutesHigh: number;
  avgRunSeconds: number;
  successRate: number; // 0-100, e.g. 96.8
  rating: number; // 0-5, e.g. 4.8
  reputation: number; // 0-100
  tasksCompleted: number;
  verified: boolean;
  hue: number; // 0-360, avatar color
  isLive: boolean;
  ownerId: string | null;
  createdAt: string;
}

export interface AgentDetail extends Agent {
  stats: {
    tasksLast30d: number;
    achievedRate: number | null; // % of rated tasks marked "Achieved", null if no ratings
    recentTasks: { id: string; title: string; status: TaskStatus; completedAt: string | null }[];
  };
  inWorkforce: boolean; // false when not signed in
}

export type TaskStatus = "PLANNING" | "RUNNING" | "COMPLETED" | "FAILED" | "REFUNDED";
export type Depth = "focused" | "standard" | "deep";
export type Outcome = "Achieved" | "Partially" | "Not achieved";

export interface TaskStep {
  id: string;
  order: number; // 0-based
  agentId: string | null;
  agentName: string;
  role: string; // "Research", "Analysis", "Verification", "Report"
  title: string; // what this step does, e.g. "Collect sources"
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  output: string | null; // markdown
  startedAt: string | null;
  completedAt: string | null;
  liveOutput: string | null; // v3: text streamed so far while status is RUNNING (null otherwise)
}

/** v3: a numbered source agents may cite inline as [n]. */
export interface TaskSource {
  n: number; // 1-based citation number
  kind: "web" | "wikipedia" | "link" | "upload";
  title: string;
  url: string | null;
  domain: string | null;
  snippet: string;
  publishedAt: string | null;
}

export type AttachmentKind = "pdf" | "csv" | "xlsx" | "docx" | "txt" | "md" | "url";

/** v3: client material; the extracted text stays on the server. */
export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  url: string | null;
  charCount: number;
  createdAt: string;
}

/** v3: a version of the report. Version 1 = the original result. */
export interface TaskRevision {
  id: string;
  version: number;
  instruction: string; // "Original report" for version 1
  status: "RUNNING" | "COMPLETED" | "FAILED";
  result: string | null;
  costCents: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  category: string | null;
  depth: Depth;
  status: TaskStatus;
  costCents: number;
  result: string | null; // final markdown report — v3: always the LATEST completed revision
  errorMessage: string | null;
  outcome: Outcome | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  agentId: string | null; // lead agent
  agent: Agent | null;
  steps: TaskStep[]; // ordered; always included
  // v3
  sources: TaskSource[]; // ordered by n
  attachments: Attachment[];
  revisions: TaskRevision[]; // ordered by version; empty until the first follow-up
  shareToken: string | null; // public link = /r/<shareToken> when not null
  isTest: boolean; // developer test run
  teamId: string | null;
  createdBy: { id: string; name: string }; // who started it (differs from you for team tasks)
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  options: string[]; // 0-4 quick-pick answers; free text is always allowed
}

/** v3: what /r/<token> shows — no private fields. */
export interface PublicReport {
  token: string;
  title: string;
  category: string | null;
  depth: Depth;
  result: string; // latest version, markdown
  version: number;
  sources: TaskSource[];
  completedAt: string | null;
  leadAgent: Agent | null;
  team: { agentName: string; role: string; title: string }[];
}

/** v3: gallery card / detail. `content` is only present on the detail endpoint. */
export interface GalleryItem {
  slug: string;
  title: string;
  category: string;
  summary: string;
  agentName: string;
  depth: Depth;
  isExample: boolean; // true = curated example written for the demo; false = a featured real report
  sources: TaskSource[];
  content?: string;
  createdAt: string;
}

export interface TeamMember {
  agentId: string;
  agentName: string;
  role: string;
  title: string;
}

export interface TaskEstimate {
  title: string;
  category: string;
  depth: Depth;
  leadAgent: Agent;
  alternatives: Agent[]; // up to 3 other good-fit agents
  team: TeamMember[]; // the steps that will run, in order
  capabilities: string[]; // required capabilities detected
  costCents: number;
  estMinutesLow: number;
  estMinutesHigh: number;
  manualHoursEstimate: number; // how long a human would take
}

export type Frequency = "Weekly" | "Monthly" | "Quarterly";

export interface Workflow {
  id: string;
  name: string;
  basedOnText: string;
  frequency: Frequency;
  depth: Depth;
  agentId: string | null;
  isActive: boolean;
  nextRun: string | null;
  lastRun: string | null;
  runCount: number;
  createdAt: string;
}

export interface Transaction {
  id: string;
  type: "TASK_CHARGE" | "REFUND" | "TOP_UP" | "PURCHASE";
  amountCents: number; // negative for charges, positive for refunds/top-ups
  description: string;
  taskId: string | null;
  createdAt: string;
  actor: { id: string; name: string } | null; // v3: who triggered it (team wallets)
}

export interface Billing {
  balanceCents: number;
  monthSpendCents: number;
  lifetimeSpendCents: number;
  transactions: Transaction[]; // newest first
}

export interface DeveloperAgentStats extends Agent {
  revenueCents: number; // developer's share (80%) of task revenue
  tasksRun: number;
  achievedRate: number | null;
}

export interface DeveloperStats {
  agents: DeveloperAgentStats[];
  totalRevenueCents: number;
  totalTasks: number;
  platformFeePercent: number; // 20
  monthly: { month: string; revenueCents: number; tasks: number }[]; // last 6 months, oldest first, "2026-05"
  testRunsToday: number; // v3
  testRunsPerDay: number; // v3
}

export interface PlatformStats {
  agents: number;
  liveAgents: number;
  tasksCompleted: number; // seeded catalog counters + real completions (sample-heavy in a fresh demo)
  realTasksCompleted: number; // real COMPLETED tasks in this deployment's database
  tasksRunning: number;
  users: number;
  developers: number;
  avgSuccessRate: number;
  categories: { category: string; agents: number }[];
}

/** Public, unauthenticated deployment settings so the UI can adapt to how the server is configured. */
export interface PublicConfig {
  demoMode: boolean; // public demo: show demo banner + AI disclaimers
  inviteRequired: boolean; // signup needs an invite code
  topupEnabled: boolean; // demo credit top-ups allowed
  topupMaxCents: number; // lifetime demo top-up cap per user (0 = none allowed)
  startingCreditsCents: number;
  maxTasksPerUserPerDay: number;
  maxDescriptionLength: number;
  aiProviderLabel: string; // human-readable, e.g. "Groq (GPT-OSS 120B)", "Claude", "Local model (Ollama)"
  sampleCatalogStats: boolean; // agent ratings/success/task counts are seeded sample data
  // v3
  searchEnabled: boolean; // agents can research the web/Wikipedia
  searchProviderLabel: string; // "Tavily web search" | "Wikipedia" | "Off"
  emailEnabled: boolean; // task-done emails + password reset work
  paymentsEnabled: boolean; // Stripe Checkout for credit packs
  creditPacks: CreditPack[];
  guestTrialEnabled: boolean;
  guestCreditsCents: number;
  turnstileSiteKey: string | null; // Cloudflare Turnstile; when set, guest trial + signup require a token
  followupCostCents: number;
  clarifyEnabled: boolean;
  maxAttachments: number; // per task
  maxAttachmentChars: number; // per attachment (extracted text)
  devTestRunsPerDay: number;
}

export interface CreditPack {
  id: string;
  label: string; // "Starter"
  priceCents: number; // money charged
  credits: number; // credits granted (cents)
  popular?: boolean;
}

export interface TeamMemberInfo {
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
  joinedAt: string;
  tasksThisMonth: number;
}

export interface TeamInviteInfo {
  id: string;
  token: string; // invite link = /join/<token>
  maxUses: number;
  uses: number;
  expiresAt: string;
  createdAt: string;
}

export interface TeamDetail {
  id: string;
  name: string;
  role: TeamRole; // your role
  owner: { id: string; name: string };
  members: TeamMemberInfo[];
  invites: TeamInviteInfo[]; // active ones; empty for members (owner only)
  walletCents: number;
  createdAt: string;
}

export interface InvitePreview {
  teamName: string;
  ownerName: string;
  memberCount: number;
  valid: boolean;
  reason: string | null; // why not valid: "expired" | "revoked" | "used up"
}

export interface DayCount {
  day: string; // "2026-10-04" (UTC)
  count: number;
}

/** v3: owner dashboard (ADMIN_EMAILS only). */
export interface AdminOverview {
  generatedAt: string;
  users: { total: number; guests: number; developers: number; signupsLast14d: DayCount[] };
  tasks: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    runsToday: number;
    dailyCapGlobal: number;
    completedLast14d: DayCount[];
    failedLast14d: DayCount[];
  };
  ai: {
    providerLabel: string;
    callsToday: number;
    failuresToday: number;
    tokensInToday: number;
    tokensOutToday: number;
    tokensLast14d: DayCount[]; // in + out
  };
  search: { providerLabel: string; callsToday: number; callsThisMonth: number; dailyBudget: number };
  email: { enabled: boolean; sentToday: number };
  money: { purchasesCents: number; purchasesCount: number; demoTopupsCents: number };
  topAgents: { agentId: string; name: string; runs: number; achievedRate: number | null }[];
  recentFailures: { taskId: string; title: string; error: string; at: string }[];
  recentUsers: { id: string; name: string; email: string; isGuest: boolean; accountType: AccountType; createdAt: string; tasks: number }[];
  shareableReports: { taskId: string; title: string; shareToken: string; completedAt: string | null; featured: boolean }[];
  gallery: GalleryItem[];
}

export interface AgentListQuery {
  q?: string;
  category?: string;
  sort?: "recommended" | "rating" | "price" | "tasks" | "newest";
  verified?: boolean;
}

export interface PublishAgentInput {
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  specialty: string;
  taskType: string;
  outputType: string;
  systemPrompt: string;
  pricePerTaskCents: number;
  estMinutesLow: number;
  estMinutesHigh: number;
}

// ---------- Plumbing ----------

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError("Can't reach the Ensemblis server. Is the backend running?", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

function qs(params: Record<string, string | number | boolean | undefined>) {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "" && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
}

// ---------- Endpoints ----------

export const api = {
  // Auth
  config: () => request<PublicConfig>("/api/config"),
  signup: (body: {
    email: string;
    password: string;
    name: string;
    company?: string;
    accountType: AccountType;
    builds?: string;
    acceptedTerms: true; // required: user ticked "I agree to the Terms and Privacy Policy"
    inviteCode?: string; // required when config.inviteRequired
    turnstileToken?: string; // required when config.turnstileSiteKey is set
  }) =>
    request<{ token: string; user: User }>("/api/auth/signup", { method: "POST", body: json(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: json(body) }),
  me: () => request<{ user: User }>("/api/auth/me"),
  updateMe: (body: Partial<Pick<User, "name" | "company" | "role" | "builds" | "emailOnTaskDone">>) =>
    request<{ user: User }>("/api/auth/me", { method: "PATCH", body: json(body) }),
  // Changing the password ends every other session; store the returned token to keep THIS device signed in.
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ ok: true; token: string }>("/api/auth/password", { method: "POST", body: json(body) }),
  // v3: always resolves {ok:true} (never reveals whether an email exists); emails a link when email is enabled
  forgotPassword: (email: string) => request<{ ok: true }>("/api/auth/forgot", { method: "POST", body: json({ email }) }),
  resetPassword: (body: { token: string; password: string }) =>
    request<{ token: string; user: User }>("/api/auth/reset", { method: "POST", body: json(body) }),

  // v3: Guest trial — creates a temporary account with config.guestCreditsCents; store the token with setToken()
  guestStart: (body: { acceptedTerms: true; turnstileToken?: string }) =>
    request<{ token: string; user: User }>("/api/guest/start", { method: "POST", body: json(body) }),
  // v3: turns the signed-in GUEST into a real account, keeping its tasks
  claimAccount: (body: {
    email: string;
    password: string;
    name: string;
    company?: string;
    accountType: AccountType;
    builds?: string;
    acceptedTerms: true;
  }) => request<{ token: string; user: User }>("/api/auth/claim", { method: "POST", body: json(body) }),

  // Public stats
  stats: () => request<PlatformStats>("/api/stats"),

  // Agents
  listAgents: (query: AgentListQuery = {}) =>
    request<{ agents: Agent[]; categories: string[] }>(`/api/agents${qs({ ...query })}`),
  getAgent: (idOrSlug: string) => request<{ agent: AgentDetail }>(`/api/agents/${encodeURIComponent(idOrSlug)}`),
  listMyAgents: () => request<{ agents: Agent[] }>("/api/agents/mine/list"),
  publishAgent: (body: PublishAgentInput) => request<{ agent: Agent }>("/api/agents", { method: "POST", body: json(body) }),
  updateAgent: (id: string, body: Partial<PublishAgentInput & { isLive: boolean }>) =>
    request<{ agent: Agent }>(`/api/agents/${id}`, { method: "PATCH", body: json(body) }),

  // Tasks
  estimateTask: (body: { description: string; depth?: Depth; agentId?: string }) =>
    request<{ estimate: TaskEstimate }>("/api/tasks/estimate", { method: "POST", body: json(body) }),
  // scope: "mine" = tasks you started, "team" = your team's tasks, omitted = everything you can see
  listTasks: (scope?: "mine" | "team") => request<{ tasks: Task[] }>(`/api/tasks${qs({ scope })}`),
  getTask: (id: string) => request<{ task: Task }>(`/api/tasks/${id}`),
  createTask: (body: { description: string; title?: string; depth?: Depth; agentId?: string; attachmentIds?: string[] }) =>
    request<{ task: Task; user: User }>("/api/tasks", { method: "POST", body: json(body) }),
  // v3: 0-3 questions that would sharpen a vague brief; [] when the brief is clear or the feature is off (never throws for that)
  clarify: (description: string) =>
    request<{ questions: ClarifyQuestion[] }>("/api/tasks/clarify", { method: "POST", body: json({ description }) }),
  // v3: follow-up refinement of a COMPLETED task; charges config.followupCostCents
  createRevision: (taskId: string, instruction: string) =>
    request<{ task: Task; user: User }>(`/api/tasks/${taskId}/revisions`, { method: "POST", body: json({ instruction }) }),
  // v3: turn the public read-only link on/off (COMPLETED tasks only)
  setShare: (taskId: string, enabled: boolean) =>
    request<{ task: Task }>(`/api/tasks/${taskId}/share`, { method: "POST", body: json({ enabled }) }),

  // v3: Attachments (upload before creating the task, then pass attachmentIds)
  createAttachment: (body: { kind: Exclude<AttachmentKind, "url">; name: string; text: string }) =>
    request<{ attachment: Attachment }>("/api/attachments", { method: "POST", body: json(body) }),
  createLinkAttachment: (url: string) =>
    request<{ attachment: Attachment }>("/api/attachments/link", { method: "POST", body: json({ url }) }),
  deleteAttachment: (id: string) => request<{ ok: true }>(`/api/attachments/${id}`, { method: "DELETE" }),

  // v3: Public pages (no auth)
  getPublicReport: (token: string) => request<{ report: PublicReport }>(`/api/public/reports/${encodeURIComponent(token)}`),
  listGallery: () => request<{ items: GalleryItem[] }>("/api/gallery"),
  getGalleryItem: (slug: string) => request<{ item: GalleryItem }>(`/api/gallery/${encodeURIComponent(slug)}`),
  retryTask: (id: string) => request<{ task: Task; user: User }>(`/api/tasks/${id}/retry`, { method: "POST" }),
  sendFeedback: (id: string, outcome: Outcome) =>
    request<{ task: Task }>(`/api/tasks/${id}/feedback`, { method: "POST", body: json({ outcome }) }),

  // Workflows (recurring tasks)
  listWorkflows: () => request<{ workflows: Workflow[] }>("/api/workflows"),
  createWorkflow: (body: { name: string; basedOnText: string; frequency: Frequency; depth?: Depth; agentId?: string }) =>
    request<{ workflow: Workflow }>("/api/workflows", { method: "POST", body: json(body) }),
  updateWorkflow: (id: string, body: Partial<Pick<Workflow, "isActive" | "frequency" | "name" | "depth">>) =>
    request<{ workflow: Workflow }>(`/api/workflows/${id}`, { method: "PATCH", body: json(body) }),
  deleteWorkflow: (id: string) => request<{ ok: true }>(`/api/workflows/${id}`, { method: "DELETE" }),
  runWorkflow: (id: string) => request<{ task: Task; user: User }>(`/api/workflows/${id}/run`, { method: "POST" }),

  // Workforce (saved agents)
  listWorkforce: () => request<{ agents: Agent[] }>("/api/workforce"),
  addToWorkforce: (agentId: string) => request<{ ok: true }>(`/api/workforce/${agentId}`, { method: "POST" }),
  removeFromWorkforce: (agentId: string) => request<{ ok: true }>(`/api/workforce/${agentId}`, { method: "DELETE" }),

  // Billing (demo credits — no real payments yet)
  billing: () => request<Billing>("/api/billing"),
  topUp: (amountCents: number) =>
    request<{ billing: Billing; user: User }>("/api/billing/topup", { method: "POST", body: json({ amountCents }) }),
  // v3: Stripe Checkout — redirect the browser to `url`; credits arrive via webhook, then Stripe returns to /billing?checkout=success
  createCheckout: (packId: string) =>
    request<{ url: string }>("/api/billing/checkout", { method: "POST", body: json({ packId }) }),

  // Developer
  developerStats: () => request<DeveloperStats>("/api/developer/stats"),
  // v3: free single-agent test run of YOUR agent (config.devTestRunsPerDay per day)
  devTestRun: (agentId: string, description: string) =>
    request<{ task: Task }>(`/api/developer/agents/${agentId}/test-run`, { method: "POST", body: json({ description }) }),

  // v3: Teams (one shared wallet = the owner's balance)
  getTeam: () => request<{ team: TeamDetail | null }>("/api/team"),
  createTeam: (name: string) => request<{ team: TeamDetail; user: User }>("/api/team", { method: "POST", body: json({ name }) }),
  renameTeam: (name: string) => request<{ team: TeamDetail }>("/api/team", { method: "PATCH", body: json({ name }) }),
  deleteTeam: () => request<{ user: User }>("/api/team", { method: "DELETE" }), // owner: dissolves the team
  createInvite: () => request<{ invite: TeamInviteInfo }>("/api/team/invites", { method: "POST" }),
  revokeInvite: (inviteId: string) => request<{ ok: true }>(`/api/team/invites/${inviteId}`, { method: "DELETE" }),
  previewInvite: (token: string) => request<{ invite: InvitePreview }>(`/api/team/invites/${encodeURIComponent(token)}`),
  joinTeam: (token: string) => request<{ team: TeamDetail; user: User }>("/api/team/join", { method: "POST", body: json({ token }) }),
  removeMember: (userId: string) => request<{ team: TeamDetail }>(`/api/team/members/${userId}`, { method: "DELETE" }),
  leaveTeam: () => request<{ user: User }>("/api/team/leave", { method: "POST" }),

  // v3: Owner dashboard (ADMIN_EMAILS only → 403 otherwise)
  adminOverview: () => request<AdminOverview>("/api/admin/overview"),
  adminFeature: (body: { taskId: string; title?: string; summary?: string }) =>
    request<{ item: GalleryItem }>("/api/admin/gallery", { method: "POST", body: json(body) }),
  adminUnfeature: (slug: string) => request<{ ok: true }>(`/api/admin/gallery/${encodeURIComponent(slug)}`, { method: "DELETE" }),
};
