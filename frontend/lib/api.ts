// =====================================================================
// Ensemblis API contract — the single source of truth shared by the
// frontend and the backend. Every endpoint below is implemented in
// backend/src. Money is always integer cents (EUR). 1 credit = 1 cent.
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
  credits: number; // cents
  createdAt: string;
}

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
}

export interface Task {
  id: string;
  title: string;
  description: string;
  category: string | null;
  depth: Depth;
  status: TaskStatus;
  costCents: number;
  result: string | null; // final markdown report
  errorMessage: string | null;
  outcome: Outcome | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  agentId: string | null; // lead agent
  agent: Agent | null;
  steps: TaskStep[]; // ordered; always included
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
  type: "TASK_CHARGE" | "REFUND" | "TOP_UP";
  amountCents: number; // negative for charges, positive for refunds/top-ups
  description: string;
  taskId: string | null;
  createdAt: string;
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
}

export interface PlatformStats {
  agents: number;
  liveAgents: number;
  tasksCompleted: number;
  tasksRunning: number;
  users: number;
  developers: number;
  avgSuccessRate: number;
  categories: { category: string; agents: number }[];
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
  signup: (body: { email: string; password: string; name: string; company?: string; accountType: AccountType; builds?: string }) =>
    request<{ token: string; user: User }>("/api/auth/signup", { method: "POST", body: json(body) }),
  login: (body: { email: string; password: string }) =>
    request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: json(body) }),
  me: () => request<{ user: User }>("/api/auth/me"),
  updateMe: (body: Partial<Pick<User, "name" | "company" | "role" | "builds">>) =>
    request<{ user: User }>("/api/auth/me", { method: "PATCH", body: json(body) }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ ok: true }>("/api/auth/password", { method: "POST", body: json(body) }),

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
  listTasks: () => request<{ tasks: Task[] }>("/api/tasks"),
  getTask: (id: string) => request<{ task: Task }>(`/api/tasks/${id}`),
  createTask: (body: { description: string; title?: string; depth?: Depth; agentId?: string }) =>
    request<{ task: Task; user: User }>("/api/tasks", { method: "POST", body: json(body) }),
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

  // Developer
  developerStats: () => request<DeveloperStats>("/api/developer/stats"),
};
