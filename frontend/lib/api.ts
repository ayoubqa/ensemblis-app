// =====================================================================
// Ensemblis API contract — mirrors backend/src (engine/serialize.ts and the
// route files). Money is always integer EUR cents. Dates are ISO strings.
//
// The product model:
//   Objective        a desired business outcome (+ success criteria)
//   Execution        one attempt to achieve it: plan → steps → verification → outcome
//   AI Team          executives + the specialists that implement their capabilities
//   Evidence         what supports the result (cited as [n])
//   Approval         a person's authorization
//   Exception        a situation that needs a person
//   Memory           what Ensemblis learned from operations
// =====================================================================

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const TOKEN_KEY = "ensemblis_token";
/** Fired on window when an authenticated request comes back 401 (session ended). */
export const UNAUTHORIZED_EVENT = "ensemblis:unauthorized";

// ---------- Accounts ----------

export type AccountType = "COMPANY" | "DEVELOPER";
export type TeamRole = "OWNER" | "MEMBER";

export interface User {
  id: string;
  email: string;
  name: string;
  company: string | null;
  role: string | null;
  accountType: AccountType;
  builds: string | null;
  credits: number; // cents — the spendable balance (the organization owner's wallet when in a team)
  createdAt: string;
  isGuest: boolean;
  isAdmin: boolean; // ADMIN_EMAILS match AND a verified email
  emailVerified: boolean;
  emailOnTaskDone: boolean;
  team: { id: string; name: string; role: TeamRole } | null;
  walletOwner: "self" | "team";
}

export interface Organization {
  id: string;
  name: string;
  role: TeamRole;
  teamId: string | null;
  defaultAutonomy: Autonomy;
  approvalThresholdCents: number;
  createdAt: string;
}

// ---------- Objectives & executions ----------

export type Autonomy = "REVIEW_PLAN" | "AUTO_WITHIN_BUDGET";
export type ObjectiveStatus = "DRAFT" | ExecutionStatus;
export type ExecutionStatus = "PLANNING" | "PLANNED" | "WAITING_FOR_APPROVAL" | "RUNNING" | "BLOCKED" | "VERIFYING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type StepStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
export type OutcomeStatus = "ACHIEVED" | "PARTIALLY_ACHIEVED" | "NOT_ACHIEVED" | "UNKNOWN";
export type CriterionResult = "MET" | "PARTIALLY_MET" | "NOT_MET" | "UNKNOWN";
export type VerificationStatus = "PASS" | "PASS_WITH_WARNINGS" | "FAIL";
export type ClaimStatus = "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "UNCITED" | "ESTIMATE";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type EvidenceKind = "WEB" | "WIKIPEDIA" | "DOCUMENT" | "COMPANY_CONTEXT" | "WEBSITE" | "CALCULATION" | "TOOL_OUTPUT" | "ARTIFACT";
export type ExecutiveKey = "chief_of_staff" | "marketing" | "sales" | "finance" | "operations";

export interface SuccessCriterion {
  id: string;
  order: number;
  description: string;
  kind: "qualitative" | "quantitative";
  targetValue: number | null;
  unit: string | null;
  source: "user" | "proposed";
}

export interface ExecutionSummary {
  id: string;
  attempt: number;
  status: ExecutionStatus;
  estimatedCostCents: number;
  costCents: number;
  refundedCents: number;
  verificationStatus: VerificationStatus | null;
  verificationScore: number | null;
  outcomeStatus: OutcomeStatus | null;
  outcomeSummary: string | null;
  planSource: "planner" | "fallback" | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  progress: { done: number; total: number };
  currentStep: { title: string; agent: string; executive: string; executiveTitle: string } | null;
}

export interface Objective {
  id: string;
  title: string;
  statement: string;
  contextNotes: string;
  deadline: string | null;
  budgetCents: number;
  autonomy: Autonomy;
  status: ObjectiveStatus;
  outcomeStatus: OutcomeStatus | null;
  workflowId: string | null;
  createdBy: { id: string; name: string } | null;
  criteria: SuccessCriterion[];
  latestExecution: ExecutionSummary | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface PlanInfo {
  title: string;
  objective: string;
  assumptions: string[];
  missingInformation: { question: string; whyItMatters: string; blocking: boolean }[];
  risks: string[];
  notes: string[];
  source: "planner" | "fallback";
  version: string;
  estimatedCostCents: number;
  estimatedManualHours: number | null;
}

export interface ExecutionStep {
  id: string;
  key: string;
  order: number;
  title: string;
  purpose: string;
  executive: ExecutiveKey;
  executiveTitle: string;
  capability: string;
  capabilityName: string;
  capabilityVersion: string;
  agent: string;
  dependsOn: string[];
  outputs: string[];
  verification: string[];
  kind: "work" | "revision";
  status: StepStatus;
  attempts: number;
  summary: string | null;
  output: string | null;
  partialOutput: string | null;
  error: string | null;
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number | null;
  costCents: number;
  retryAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  evidenceNs: number[];
}

export interface Evidence {
  id: string;
  n: number;
  kind: EvidenceKind;
  sourceKind: "web" | "wikipedia" | "upload";
  title: string;
  url: string | null;
  domain: string | null;
  snippet: string;
  publishedAt: string | null;
  stepId: string | null;
  createdAt: string;
}

export interface VerificationCheck {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail" | "not_assessed";
  score: number | null;
  detail: string;
}

export interface Verification {
  id: string;
  round: number;
  status: VerificationStatus;
  score: number;
  checks: VerificationCheck[];
  summary: string;
  warnings: string[];
  humanJudgment: string[];
  method: string;
  version: string;
  claims: { claim: string; status: ClaimStatus; evidenceNs: number[]; supportScore: number; note: string }[];
  createdAt: string;
}

export interface OutcomeMeasurement {
  criterionId: string;
  result: CriterionResult;
  measuredValue: number | null;
  measurement: string;
  explanation: string;
  method: "model-assessed" | "deterministic" | "not-assessed" | "user-confirmed";
}

export interface ExecutionEvent {
  id: number;
  type: string;
  actor: string;
  actorTitle: string;
  message: string;
  data: Record<string, unknown>;
  stepId: string | null;
  createdAt: string;
}

export interface Approval {
  id: string;
  objectiveId: string;
  objectiveTitle: string | null;
  executionId: string;
  kind: "PLAN" | "BUDGET" | "ACTION";
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  title: string;
  proposedAction: string;
  reason: string;
  costCents: number;
  risk: RiskLevel;
  recommendation: string;
  recommendedDecision: "APPROVE" | "REJECT";
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export type ExceptionAction = "provide_info" | "proceed" | "retry" | "accept" | "cancel";

export interface ExceptionItem {
  id: string;
  objectiveId: string;
  objectiveTitle: string | null;
  executionId: string;
  stepId: string | null;
  kind: "MISSING_INFORMATION" | "STEP_FAILED" | "VERIFICATION_FAILED" | "INSUFFICIENT_FUNDS" | "POLICY_BLOCKED";
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  severity: RiskLevel;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  recommendation: string;
  neededFromUser: string;
  questions: { question: string; whyItMatters: string }[];
  actions: ExceptionAction[];
  resolution: string | null;
  resolvedAction: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  kind: "PREFERENCE" | "DECISION" | "LESSON" | "CONSTRAINT" | "FACT";
  status: "ACTIVE" | "PENDING_CONFIRMATION" | "ARCHIVED";
  content: string;
  rationale: string;
  sensitive: boolean;
  source: "execution" | "user";
  sourceExecutionId: string | null;
  confirmedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Execution extends ExecutionSummary {
  objectiveId: string;
  plan: PlanInfo | null;
  plannerVersion: string | null;
  summary: string | null;
  result: string | null;
  errorMessage: string | null;
  shareToken: string | null;
  estimatedManualHours: number | null;
  outcomeConfirmedAt: string | null;
  revisionCount: number;
  steps: ExecutionStep[];
  evidence: Evidence[];
  verification: Verification | null;
  measurements: OutcomeMeasurement[];
  approvals: Approval[];
  exceptions: ExceptionItem[];
  memories: MemoryItem[];
  events: ExecutionEvent[];
  lastEventId: number;
}

export interface ObjectiveDetail {
  objective: Objective;
  executions: ExecutionSummary[];
  execution: Execution | null;
}

export interface ObjectiveCounts {
  all: number;
  active: number;
  attention: number;
  completed: number;
  drafts: number;
  closed: number;
}

export type ObjectiveGroup = "all" | "active" | "attention" | "completed" | "drafts" | "closed";

export interface CriterionInput {
  description: string;
  targetValue?: number | null;
  unit?: string | null;
}

export interface CreateObjectiveInput {
  statement: string;
  title?: string;
  successCriteria?: CriterionInput[];
  deadline?: string | null; // YYYY-MM-DD
  budgetCents?: number;
  contextNotes?: string;
  autonomy?: Autonomy;
  draft?: boolean;
}

export interface Suggestion {
  title: string;
  criteria: { description: string; targetValue: number | null; unit: string | null }[];
  questions: string[];
  source: "model" | "heuristic";
}

// ---------- AI Team ----------

export interface ToolRef {
  key: string;
  name: string;
  permission: "READ_ONLY" | "WRITE" | "EXTERNAL_ACTION" | "FINANCIAL" | "DESTRUCTIVE";
}

export interface CapabilityInfo {
  key: string;
  name: string;
  version: string;
  kind: "framing" | "research" | "analysis" | "synthesis";
  specialist: string;
  description: string;
  methodology: string[];
  deliverable: string[];
  verificationFocus: string[];
  tools: ToolRef[];
  costCents: number;
  completedLast30d: number;
}

export interface ExecutiveInfo {
  key: ExecutiveKey;
  title: string;
  department: string;
  reportsTo: ExecutiveKey | null;
  mandate: string;
  capabilities: CapabilityInfo[];
  working: { stepTitle: string; agent: string; capability: string; objectiveId: string; objectiveTitle: string; startedAt: string | null }[];
}

export interface AITeam {
  version: string;
  verificationCostCents: number;
  executives: ExecutiveInfo[];
  tools: { key: string; name: string; description: string; permission: ToolRef["permission"]; trust: string; version: string }[];
  policy: { granted: string[]; notGranted: string[]; note: string };
}

// ---------- Company context ----------

export interface CompanyContext {
  companyName: string;
  description: string;
  products: string;
  businessModel: string;
  customers: string;
  markets: string;
  goals: string;
  website: string;
  websiteFetchedAt: string | null;
  websiteChars: number;
  updatedAt: string;
}

export type DocumentKind = "pdf" | "csv" | "xlsx" | "docx" | "txt" | "md" | "url";

export interface ContextDocument {
  id: string;
  kind: DocumentKind;
  name: string;
  url: string | null;
  charCount: number;
  createdAt: string;
}

export interface ContextPayload {
  context: CompanyContext;
  completeness: { filled: number; total: number; missing: string[] };
  documents: ContextDocument[];
  maxDocuments: number;
}

// ---------- Dashboard ----------

export interface Briefing {
  greetingName: string;
  orgName: string;
  objectives: { active: number; running: number; blocked: number; waiting: number; completed: number; drafts: number; total: number };
  attention: { approvals: Approval[]; exceptions: ExceptionItem[] };
  team: {
    working: { executive: ExecutiveKey; executiveTitle: string; agent: string; stepTitle: string; objectiveId: string; objectiveTitle: string; startedAt: string | null }[];
    activity: (ExecutionEvent & { objectiveId: string; objectiveTitle: string })[];
  };
  usage: { balanceCents: number; walletOwner: "self" | "team"; monthSpendCents: number; executionsThisMonth: number };
  recentOutcomes: {
    executionId: string;
    objectiveId: string;
    objectiveTitle: string;
    completedAt: string | null;
    costCents: number;
    outcomeStatus: OutcomeStatus | null;
    outcomeSummary: string | null;
    verificationStatus: VerificationStatus | null;
    verificationScore: number | null;
  }[];
  context: { filled: number; total: number; missing: string[] };
  value30d: { criteriaMet: number; estimatedHoursReturned: number; executionCostCents: number };
}

export interface Attention {
  approvals: number;
  exceptions: number;
  running: number;
}

// ---------- Usage / billing ----------

export interface Transaction {
  id: string;
  type: "TASK_CHARGE" | "REFUND" | "TOP_UP" | "PURCHASE";
  amountCents: number; // negative for charges
  description: string;
  taskId: string | null;
  executionId: string | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface Billing {
  balanceCents: number;
  walletOwner: "self" | "team";
  monthSpendCents: number;
  lifetimeSpendCents: number;
  usage: {
    monthExecutions: number;
    monthExecutionSpendCents: number;
    avgExecutionCostCents: number;
    byObjective: { objectiveId: string; title: string; spendCents: number; executions: number }[];
  };
  transactions: Transaction[];
  nextCursor: string | null;
}

export interface CreditPack {
  id: string;
  label: string;
  priceCents: number;
  credits: number;
  popular?: boolean;
}

// ---------- Recurring objectives ----------

export type Frequency = "Weekly" | "Monthly" | "Quarterly";

export interface Workflow {
  id: string;
  name: string;
  basedOnText: string;
  frequency: Frequency;
  isActive: boolean;
  nextRun: string | null;
  lastRun: string | null;
  runCount: number;
  createdAt: string;
  successCriteria: string[];
  budgetCents: number | null;
  autonomy: Autonomy | null;
  lastObjectiveId: string | null;
}

// ---------- Legacy reports (v1–v3 tasks) ----------

export type TaskStatus = "PLANNING" | "RUNNING" | "COMPLETED" | "FAILED" | "REFUNDED";
export type Depth = "focused" | "standard" | "deep";

/** A numbered source [n] (legacy task sources and the public share shape). */
export interface TaskSource {
  n: number;
  kind: "web" | "wikipedia" | "link" | "upload";
  title: string;
  url: string | null;
  domain: string | null;
  snippet: string;
  publishedAt: string | null;
}

export interface LegacyTask {
  id: string;
  title: string;
  description: string;
  category: string | null;
  depth: Depth;
  status: TaskStatus;
  costCents: number;
  result: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  steps: { id: string; order: number; agentName: string; role: string; title: string; status: string }[];
  sources: TaskSource[];
  /** Follow-up versions written on the old system; the newest completed one is the current report. */
  revisions?: { version: number; status: string; result: string | null; completedAt: string | null }[];
  shareToken: string | null;
  createdBy: { id: string; name: string };
}

/** What /r/<token> shows — no private fields. */
export interface PublicReport {
  kind: "task" | "execution";
  token: string;
  title: string;
  category: string | null;
  depth: Depth;
  result: string;
  version: number;
  sources: TaskSource[];
  completedAt: string | null;
  /** Legacy task reports only. */
  leadAgent: { name: string; hue?: number } | null;
  team: { agentName: string; role: string; title: string }[];
  objective?: {
    title: string;
    criteria: SuccessCriterion[];
    measurements: OutcomeMeasurement[];
    outcomeStatus: OutcomeStatus | null;
    outcomeSummary: string | null;
  };
  verification?: { status: VerificationStatus; score: number; summary: string; warnings: string[]; checks: VerificationCheck[] } | null;
}

// ---------- Teams (organization members) ----------

export interface TeamMemberInfo {
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
  joinedAt: string;
  objectivesThisMonth: number;
}

export interface TeamInviteInfo {
  id: string;
  token: string;
  maxUses: number;
  uses: number;
  expiresAt: string;
  createdAt: string;
}

export interface TeamDetail {
  id: string;
  name: string;
  role: TeamRole;
  owner: { id: string; name: string };
  members: TeamMemberInfo[];
  invites: TeamInviteInfo[];
  walletCents: number;
  createdAt: string;
}

export interface InvitePreview {
  teamName: string;
  ownerName: string;
  memberCount: number;
  valid: boolean;
  reason: string | null;
}

// ---------- Deployment config ----------

export interface PublicConfig {
  demoMode: boolean;
  inviteRequired: boolean;
  topupEnabled: boolean;
  topupMaxCents: number;
  startingCreditsCents: number;
  maxTasksPerUserPerDay: number;
  maxDescriptionLength: number;
  aiProviderLabel: string;
  mockAI: boolean;
  verificationCostCents: number;
  searchEnabled: boolean;
  searchProviderLabel: string;
  emailEnabled: boolean;
  paymentsEnabled: boolean;
  creditPacks: CreditPack[];
  guestTrialEnabled: boolean;
  guestCreditsCents: number;
  turnstileSiteKey: string | null;
  maxAttachments: number;
  maxAttachmentChars: number;
}

// ---------- Owner dashboard ----------

export interface DayCount {
  day: string;
  count: number;
}

export interface AdminOverview {
  generatedAt: string;
  users: { total: number; guests: number; organizations: number; signupsLast14d: DayCount[] };
  executions: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    inFlight: number;
    waiting: number;
    verification: { pass: number; warnings: number; failedAccepted: number };
    openExceptions: number;
    pendingApprovals: number;
    runsToday: number;
    dailyCapGlobal: number;
    completedLast14d: DayCount[];
    failedLast14d: DayCount[];
    legacyTasks: number;
  };
  queue: { queued: number; running: number; deadLast24h: number; oldestQueuedSeconds: number };
  ai: { providerLabel: string; callsToday: number; failuresToday: number; tokensInToday: number; tokensOutToday: number; tokensLast14d: DayCount[] };
  search: { providerLabel: string; callsToday: number; callsThisMonth: number; dailyBudget: number };
  email: { enabled: boolean; sentToday: number };
  money: { purchasesCents: number; purchasesCount: number; demoTopupsCents: number };
  recentFailures: { executionId: string; objectiveId: string; title: string; error: string; at: string }[];
  recentUsers: { id: string; name: string; email: string; isGuest: boolean; verified: boolean; createdAt: string }[];
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

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

// These answer 401 for a wrong password, which says nothing about the session in this browser (a
// guest who mistypes their real account's password must keep the trial).
const CREDENTIAL_CHECKS = new Set(["/api/auth/login", "/api/auth/signup", "/api/auth/forgot", "/api/auth/reset"]);

/**
 * Every request goes through here. A 401 means the session ended (expired,
 * password changed, account removed, or signed out in another tab): the token
 * that failed is dropped and UNAUTHORIZED_EVENT tells the app to sign out —
 * unless another tab stored a different token meanwhile (e.g. a password change
 * issues a new one), which stays.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError("Can't reach the Ensemblis server. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !CREDENTIAL_CHECKS.has(path) && getToken() === token) {
    if (token) setToken(null);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: data.error }));
  }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
}

// ---------- Endpoints ----------

export const api = {
  // Auth & account
  config: () => request<PublicConfig>("/api/config"),
  signup: (body: { email: string; password: string; name: string; company?: string; acceptedTerms: true; inviteCode?: string; turnstileToken?: string }) =>
    request<{ token: string; user: User }>("/api/auth/signup", { method: "POST", body: json({ ...body, accountType: "COMPANY" }) }),
  login: (body: { email: string; password: string }) => request<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: json(body) }),
  me: () => request<{ user: User }>("/api/auth/me"),
  updateMe: (body: Partial<Pick<User, "name" | "company" | "role" | "emailOnTaskDone">>) => request<{ user: User }>("/api/auth/me", { method: "PATCH", body: json(body) }),
  changePassword: (body: { currentPassword: string; newPassword: string }) => request<{ ok: true; token: string }>("/api/auth/password", { method: "POST", body: json(body) }),
  forgotPassword: (email: string) => request<{ ok: true }>("/api/auth/forgot", { method: "POST", body: json({ email }) }),
  resetPassword: (body: { token: string; password: string }) => request<{ token: string; user: User }>("/api/auth/reset", { method: "POST", body: json(body) }),
  requestEmailVerification: () => request<{ ok: true; sent: boolean }>("/api/auth/verify-email/request", { method: "POST" }),
  verifyEmail: (token: string) => request<{ ok: true; user: User }>("/api/auth/verify-email", { method: "POST", body: json({ token }) }),
  guestStart: (body: { acceptedTerms: true; turnstileToken?: string }) => request<{ token: string; user: User }>("/api/guest/start", { method: "POST", body: json(body) }),
  claimAccount: (body: { email: string; password: string; name: string; company?: string; acceptedTerms: true }) =>
    request<{ token: string; user: User }>("/api/auth/claim", { method: "POST", body: json({ ...body, accountType: "COMPANY" }) }),

  // Organization
  getOrg: () => request<{ organization: Organization }>("/api/org"),
  updateOrg: (body: Partial<Pick<Organization, "name" | "defaultAutonomy" | "approvalThresholdCents">>) =>
    request<{ organization: Organization }>("/api/org", { method: "PATCH", body: json(body) }),

  // Dashboard
  briefing: () => request<Briefing>("/api/dashboard"),
  attention: () => request<Attention>("/api/dashboard/attention"),

  // Objectives
  suggestObjective: (statement: string) => request<{ suggestion: Suggestion }>("/api/objectives/suggest", { method: "POST", body: json({ statement }) }),
  createObjective: (body: CreateObjectiveInput) => request<{ objective: Objective; executionId: string | null }>("/api/objectives", { method: "POST", body: json(body) }),
  listObjectives: (params: { group?: ObjectiveGroup; cursor?: string; q?: string; limit?: number } = {}) =>
    request<{ objectives: Objective[]; nextCursor: string | null; counts: ObjectiveCounts }>(`/api/objectives${qs(params)}`),
  getObjective: (id: string) => request<ObjectiveDetail>(`/api/objectives/${encodeURIComponent(id)}`),
  planObjective: (id: string) => request<ObjectiveDetail & { executionId: string }>(`/api/objectives/${encodeURIComponent(id)}/plan`, { method: "POST" }),
  runAgain: (id: string) => request<ObjectiveDetail & { executionId: string }>(`/api/objectives/${encodeURIComponent(id)}/executions`, { method: "POST" }),
  replaceCriteria: (id: string, criteria: CriterionInput[]) =>
    request<ObjectiveDetail>(`/api/objectives/${encodeURIComponent(id)}/criteria`, { method: "PUT", body: json({ criteria }) }),

  // Executions
  getExecution: (id: string) => request<{ execution: Execution }>(`/api/executions/${encodeURIComponent(id)}`),
  executionEvents: (id: string, after = 0) => request<{ events: ExecutionEvent[] }>(`/api/executions/${encodeURIComponent(id)}/events${qs({ after })}`),
  cancelExecution: (id: string) => request<{ execution: Execution }>(`/api/executions/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  shareExecution: (id: string, enabled: boolean) =>
    request<{ shareToken: string | null }>(`/api/executions/${encodeURIComponent(id)}/share`, { method: "POST", body: json({ enabled }) }),
  confirmOutcome: (id: string, status: Exclude<OutcomeStatus, "UNKNOWN">, note?: string) =>
    request<{ execution: Execution }>(`/api/executions/${encodeURIComponent(id)}/outcome`, { method: "POST", body: json({ status, note }) }),

  // Approvals & exceptions
  listApprovals: (status: "PENDING" | "ALL" = "PENDING") => request<{ approvals: Approval[] }>(`/api/approvals${qs({ status })}`),
  approve: (id: string, note?: string) => request<{ approval: Approval; executionId: string }>(`/api/approvals/${encodeURIComponent(id)}/approve`, { method: "POST", body: json({ note }) }),
  reject: (id: string, note?: string) => request<{ approval: Approval; executionId: string }>(`/api/approvals/${encodeURIComponent(id)}/reject`, { method: "POST", body: json({ note }) }),
  listExceptions: (status: "OPEN" | "ALL" = "OPEN") => request<{ exceptions: ExceptionItem[] }>(`/api/exceptions${qs({ status })}`),
  resolveException: (id: string, action: ExceptionAction, response?: string) =>
    request<{ exception: ExceptionItem; executionId: string }>(`/api/exceptions/${encodeURIComponent(id)}/resolve`, { method: "POST", body: json({ action, response }) }),

  // AI Team
  aiTeam: () => request<AITeam>("/api/ai-team"),

  // Company context
  getContext: () => request<ContextPayload>("/api/context"),
  updateContext: (body: Partial<Omit<CompanyContext, "websiteFetchedAt" | "websiteChars" | "updatedAt">>) =>
    request<ContextPayload>("/api/context", { method: "PUT", body: json(body) }),
  refreshWebsite: () => request<ContextPayload>("/api/context/website/refresh", { method: "POST" }),
  addDocument: (body: { kind: Exclude<DocumentKind, "url">; name: string; text: string }) =>
    request<ContextPayload & { document: ContextDocument }>("/api/context/documents", { method: "POST", body: json(body) }),
  addLinkDocument: (url: string) => request<ContextPayload & { document: ContextDocument }>("/api/context/documents/link", { method: "POST", body: json({ url }) }),
  deleteDocument: (id: string) => request<ContextPayload>(`/api/context/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Memory
  listMemory: (status?: MemoryItem["status"]) => request<{ memories: MemoryItem[] }>(`/api/memory${qs({ status })}`),
  addMemory: (body: { kind: MemoryItem["kind"]; content: string }) => request<{ memory: MemoryItem }>("/api/memory", { method: "POST", body: json(body) }),
  updateMemory: (id: string, body: Partial<Pick<MemoryItem, "kind" | "content">> & { status?: "ACTIVE" | "ARCHIVED" }) =>
    request<{ memory: MemoryItem }>(`/api/memory/${encodeURIComponent(id)}`, { method: "PATCH", body: json(body) }),
  deleteMemory: (id: string) => request<{ ok: true }>(`/api/memory/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Recurring objectives
  listWorkflows: () => request<{ workflows: Workflow[] }>("/api/workflows"),
  createWorkflow: (body: { name: string; basedOnText: string; frequency: Frequency; successCriteria?: string[]; budgetCents?: number; autonomy?: Autonomy }) =>
    request<{ workflow: Workflow }>("/api/workflows", { method: "POST", body: json(body) }),
  updateWorkflow: (id: string, body: Partial<Pick<Workflow, "isActive" | "frequency" | "name" | "successCriteria" | "budgetCents" | "autonomy">>) =>
    request<{ workflow: Workflow }>(`/api/workflows/${id}`, { method: "PATCH", body: json(body) }),
  deleteWorkflow: (id: string) => request<{ ok: true }>(`/api/workflows/${id}`, { method: "DELETE" }),
  runWorkflow: (id: string) => request<{ objectiveId: string; executionId: string | null }>(`/api/workflows/${id}/run`, { method: "POST" }),

  // Usage
  billing: () => request<Billing>("/api/billing"),
  moreTransactions: (cursor: string) => request<{ transactions: Transaction[]; nextCursor: string | null }>(`/api/billing/transactions${qs({ cursor })}`),
  topUp: (amountCents: number) => request<{ billing: Billing; user: User }>("/api/billing/topup", { method: "POST", body: json({ amountCents }) }),
  createCheckout: (packId: string) => request<{ url: string }>("/api/billing/checkout", { method: "POST", body: json({ packId }) }),

  // Legacy reports
  listLegacyReports: (cursor?: string) => request<{ tasks: LegacyTask[]; nextCursor: string | null }>(`/api/tasks${qs({ cursor, limit: 30 })}`),
  getLegacyReport: (id: string) => request<{ task: LegacyTask }>(`/api/tasks/${encodeURIComponent(id)}`),
  shareLegacyReport: (id: string, enabled: boolean) => request<{ task: LegacyTask }>(`/api/tasks/${encodeURIComponent(id)}/share`, { method: "POST", body: json({ enabled }) }),

  // Public (no auth)
  getPublicReport: (token: string) => request<{ report: PublicReport }>(`/api/public/reports/${encodeURIComponent(token)}`),

  // Organization members (team)
  getTeam: () => request<{ team: TeamDetail | null }>("/api/team"),
  createTeam: (name: string) => request<{ team: TeamDetail; user: User }>("/api/team", { method: "POST", body: json({ name }) }),
  renameTeam: (name: string) => request<{ team: TeamDetail }>("/api/team", { method: "PATCH", body: json({ name }) }),
  deleteTeam: () => request<{ user: User }>("/api/team", { method: "DELETE" }),
  createInvite: () => request<{ invite: TeamInviteInfo }>("/api/team/invites", { method: "POST" }),
  revokeInvite: (inviteId: string) => request<{ ok: true }>(`/api/team/invites/${inviteId}`, { method: "DELETE" }),
  previewInvite: (token: string) => request<{ invite: InvitePreview }>(`/api/team/invites/${encodeURIComponent(token)}`),
  joinTeam: (token: string) => request<{ team: TeamDetail; user: User }>("/api/team/join", { method: "POST", body: json({ token }) }),
  removeMember: (userId: string) => request<{ team: TeamDetail }>(`/api/team/members/${userId}`, { method: "DELETE" }),
  leaveTeam: () => request<{ user: User }>("/api/team/leave", { method: "POST" }),

  // Owner dashboard (verified ADMIN_EMAILS only)
  adminOverview: () => request<AdminOverview>("/api/admin/overview"),
};
