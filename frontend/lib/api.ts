// =====================================================================
// Ensemblis API contract — mirrors backend/src (engine/serialize.ts and the
// route files). Wallet and price amounts (the "*Cents" fields) are whole credits;
// only credit-pack prices are euro cents (real money). Dates are ISO strings.
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
/** UNVERIFIED: the AI verifier could not run (credentials, quota, timeout, invalid output), so the result is not verified. */
export type VerificationStatus = "PASS" | "PASS_WITH_WARNINGS" | "FAIL" | "UNVERIFIED";
export type ClaimStatus = "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "UNCITED" | "ESTIMATE";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type EvidenceKind = "WEB" | "WIKIPEDIA" | "DOCUMENT" | "COMPANY_CONTEXT" | "WEBSITE" | "CALCULATION" | "TOOL_OUTPUT" | "ARTIFACT";
export type ExecutiveKey = "chief_of_staff" | "marketing" | "sales" | "finance" | "operations";
/** The deliverable an objective asks for. null = the general decision memo. */
export type ObjectiveKind = "research_brief";
/** What a claim in the report is (from the section it appears in). */
export type ClaimType = "source" | "inference" | "uncertainty" | "recommendation";

/**
 * One honest reading of where an execution ended up (backend engine/resultState.ts). It keeps
 * "the work finished" apart from "the result was verified": a completed execution whose
 * verification failed or never ran, or whose planned work (including research) was incomplete,
 * is never reported as plainly successful.
 */
export type ResultState =
  | "in_progress"
  | "blocked"
  | "failed"
  | "cancelled"
  | "verified"
  | "verified_with_warnings"
  | "partial"
  | "unverified"
  | "accepted_failed_verification";
export const RESULT_STATES: readonly ResultState[] = [
  "in_progress",
  "blocked",
  "failed",
  "cancelled",
  "verified",
  "verified_with_warnings",
  "partial",
  "unverified",
  "accepted_failed_verification",
];

/** What a research step's web search achieved. off: search is off on the server. */
export type ResearchStatus = "ok" | "degraded" | "no_results" | "failed" | "off";

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
  /** The AI-measured outcome (the verifier's reading of the report). A person's confirmation never overwrites it. */
  outcomeStatus: OutcomeStatus | null;
  /** Set once a person confirmed the outcome. */
  confirmedOutcomeStatus?: OutcomeStatus | null;
  outcomeSummary: string | null;
  // The fields below were added with real execution v1. They are optional so a console
  // served before the API upgrade still renders (see resultStateOf in lib/openIssues.ts).
  resultState?: ResultState;
  /** Why the result reads as it does (skipped steps, failed research, verification…). */
  resultReasons?: string[];
  /** True when any part of this execution actually ran on the mock AI provider. */
  usedMockAI?: boolean;
  /** Where its model and web search calls went, as recorded with it at run time. Absent from an older API. */
  endpoints?: ExecutionEndpoints;
  planSource: "planner" | "fallback" | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  progress: { done: number; total: number };
  currentStep: { title: string; agent: string; executive: string; executiveTitle: string } | null;
}

/**
 * Where an execution's calls went, recorded with it (never the server's current setting).
 * model: stub = a test stub endpoint (not a real model); local = a model on this machine or a private
 * network (self-hosted or a test endpoint); hosted = a model API. search: custom = TAVILY_BASE_URL, not
 * the public Tavily API. null: not used (the mock model, no web search) or not known (an older execution).
 */
export interface ExecutionEndpoints {
  model: "hosted" | "local" | "stub" | null;
  search: "public" | "custom" | null;
}

export interface Objective {
  id: string;
  title: string;
  statement: string;
  contextNotes: string;
  /** null (or absent) = the general decision memo. */
  kind?: ObjectiveKind | null;
  /** Constraints the plan and every step must respect (user instructions). */
  constraints?: string | null;
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
  /** Why this plan cannot run yet (no AI key, quota exhausted, or a research brief with web search off). Nothing is charged. */
  blocked?: { kind: "config" | "quota" | "search_unavailable"; message: string } | null;
}

/** One search request a research step made. Skipped providers have httpStatus null and an error that says why. */
export interface SearchAttempt {
  query: string;
  provider: string;
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  resultCount: number;
  ms: number | null;
  /** custom: the request went to TAVILY_BASE_URL, not the public Tavily API. Absent when no request was made, and on older attempts. */
  endpoint?: "public" | "custom";
}

/** What a research step did: the providers that answered, the queries sent and every attempt. */
export interface StepResearch {
  providers: string[];
  queries: string[];
  attempts: SearchAttempt[];
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
  /** true: the counts are estimates (≈4 characters per token) because the provider reported no usage; null: not known. */
  tokensEstimated?: boolean | null;
  latencyMs: number | null;
  costCents: number;
  retryAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  evidenceNs: number[];
  /** Set on steps that searched the web (or would have, with search off). */
  researchStatus?: ResearchStatus | null;
  /** Whether the output delivers what the plan said the step would; null until completed (and for older steps). */
  deliverable?: StepDeliverable | null;
  research?: StepResearch | null;
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
  /** Search provider that returned this source (tavily | wikipedia), when any. */
  provider?: string | null;
  /** The search query that found it. */
  query?: string | null;
  /** When it was retrieved (ISO). */
  retrievedAt?: string | null;
  /** How it was obtained: a search snippet, the company website, an upload, or provided by the organization (not retrieved). */
  retrieval?: "search_snippet" | "website" | "upload" | "provided" | "page_fetch" | null;
}

export interface VerificationCheck {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail" | "not_assessed";
  score: number | null;
  detail: string;
}

/** The AI verifier's verdict on one success criterion, saved with the verification round (visible before the outcome is recorded). */
export interface CriterionAssessment {
  /** 1-based, in success-criterion order. */
  index: number;
  status: CriterionResult;
  measuredValue: number | null;
  measurement: string;
  explanation: string;
  /** Evidence numbers [n] the verdict relies on (only numbers that exist in this execution). */
  evidence: number[];
}

export interface VerificationClaim {
  claim: string;
  status: ClaimStatus;
  evidenceNs: number[];
  supportScore: number;
  note: string;
  claimType?: ClaimType | null;
  /** The passage of the cited source that supports it, when found. */
  quote?: string | null;
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
  /** The model that ran the AI review (null when it did not run or was not recorded). */
  modelProvider?: string | null;
  modelName?: string | null;
  /** Why the AI review could not run (UNVERIFIED rounds). */
  assessorError?: string | null;
  criteria?: CriterionAssessment[];
  claims: VerificationClaim[];
  createdAt: string;
}

/** One verification round, oldest first in Execution.verificationHistory. */
export interface VerificationRound {
  round: number;
  status: VerificationStatus;
  score: number;
  summary: string;
  method: string;
  createdAt: string;
}

export interface OutcomeMeasurement {
  criterionId: string;
  result: CriterionResult;
  measuredValue: number | null;
  measurement: string;
  explanation: string;
  method: "model-assessed" | "deterministic" | "not-assessed" | "user-confirmed";
  /** Evidence numbers [n] the measurement relies on. */
  evidenceNs?: number[];
}

/** Model calls metered for one purpose, provider and model. */
export interface UsageByPurpose {
  purpose: string;
  provider: string;
  model: string | null;
  calls: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  /** True when any of these calls' token counts are estimates (or were not recorded as measured). */
  estimated: boolean;
}

/** Every model call and web search metered for an execution (plan, queries, steps, verification, memory). */
export interface ExecutionUsage {
  calls: number;
  failedCalls: number;
  tokensIn: number;
  tokensOut: number;
  /** Sum of model-call latencies (ms). */
  latencyMs: number;
  estimated: boolean;
  byPurpose: UsageByPurpose[];
  searches: { provider: string; calls: number; failed: number }[];
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

/** skip: continue without a failed step (the result is then partial and the step's cost is refunded). */
export type ExceptionAction = "provide_info" | "proceed" | "retry" | "skip" | "accept" | "cancel";
export type ExceptionKind = "MISSING_INFORMATION" | "STEP_FAILED" | "VERIFICATION_FAILED" | "INSUFFICIENT_FUNDS" | "POLICY_BLOCKED" | "PROVIDER_UNAVAILABLE";

export interface ExceptionItem {
  id: string;
  objectiveId: string;
  objectiveTitle: string | null;
  executionId: string;
  stepId: string | null;
  kind: ExceptionKind;
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

export type DeliverableStatus = "delivered" | "delivered_with_gaps" | "not_delivered" | "unchecked";
export interface StepDeliverable {
  status: DeliverableStatus;
  checks: { key: "substance" | "expected_outputs" | "evidence" | "citations"; status: "pass" | "warn" | "fail" | "not_assessed"; detail: string }[];
  expected: { output: string; addressed: boolean }[];
  citedEvidence: number[];
  ownEvidence: number[];
}
/** Step counts by where each stands. */
export type WorkLedger = Record<DeliverableStatus | "failed" | "skipped" | "pending" | "running", number>;

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
  /** The domains the result may link to; the report renderers show any other link as text. Absent from an older API (the evidence's domains then). */
  linkDomains?: string[];
  /** The latest verification round. */
  verification: Verification | null;
  /** Every round, oldest first (e.g. round 1 failed → revision → round 2). */
  verificationHistory?: VerificationRound[];
  usage?: ExecutionUsage;
  workLedger?: WorkLedger;
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
  /** "research_brief" asks for an evidence-backed brief; omitted or null = decision memo. */
  kind?: ObjectiveKind | null;
  constraints?: string;
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
    /** True when a person confirmed the outcome (otherwise it is the AI verifier's assessment). */
    outcomeConfirmed?: boolean;
    outcomeSummary: string | null;
    verificationStatus: VerificationStatus | null;
    verificationScore: number | null;
    /** Optional: read when the API sends them (otherwise the result state is read from the verification alone). */
    resultState?: ResultState;
    usedMockAI?: boolean;
    endpoints?: ExecutionEndpoints;
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
  /** GRANT = starting credits; ADJUSTMENT = opening balance or an operator correction. */
  type: "TASK_CHARGE" | "REFUND" | "TOP_UP" | "PURCHASE" | "GRANT" | "ADJUSTMENT";
  amountCents: number; // credits; negative for charges
  description: string;
  /** Machine-readable reason (e.g. execution_charge, execution_failed, step_skipped); null on rows from before credits. */
  reason?: string | null;
  /** Wallet balance right after this movement; null on rows from before credits. */
  balanceAfter?: number | null;
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
  /** Execution reports: the domains the result may link to (never from the owner's notes). Absent: the sources' domains. */
  linkDomains?: string[];
  completedAt: string | null;
  /** Legacy task reports only. */
  leadAgent: { name: string; hue?: number } | null;
  team: { agentName: string; role: string; title: string }[];
  /** Execution reports: taken from what the execution actually ran on. */
  usedMockAI?: boolean;
  endpoints?: ExecutionEndpoints;
  resultState?: ResultState;
  resultReasons?: string[];
  objective?: {
    title: string;
    criteria: SuccessCriterion[];
    measurements: OutcomeMeasurement[];
    /** The AI-measured outcome. */
    outcomeStatus: OutcomeStatus | null;
    /** Set once the owner confirmed the outcome. */
    confirmedOutcomeStatus?: OutcomeStatus | null;
    outcomeConfirmedAt?: string | null;
    outcomeSummary: string | null;
  };
  verification?: {
    status: VerificationStatus;
    score: number;
    summary: string;
    warnings: string[];
    checks: VerificationCheck[];
    method?: string;
    criteria?: CriterionAssessment[];
  } | null;
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
  /** false when model calls can't work on this server (unknown provider, missing key, mock where forbidden). */
  aiConfigured: boolean;
  /** Why model calls can't work, naming environment variables only (never a key); null when configured. */
  aiProblem: string | null;
  mockAI: boolean;
  /** Where this server's model calls go now: stub also for the mock AI (neither is a real model). Absent from an older API. */
  aiEndpoint?: "hosted" | "local" | "stub";
  verificationCostCents: number;
  /** Credits needed before an objective can be planned (the cheapest possible plan). Absent from an older API. */
  minimumPlanCents?: number;
  searchEnabled: boolean;
  /** The search provider actually used: tavily, wikipedia (no Tavily key) or off. */
  searchProvider: "tavily" | "wikipedia" | "off";
  searchProviderLabel: string;
  /** True when TAVILY_BASE_URL sends web search to an endpoint other than the public Tavily API (a stub or a proxy). Absent from an older API. */
  searchCustomEndpoint?: boolean;
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

/** Variable cost of a set of usage events (backend billing/economics.ts). Internal only. */
export interface CostSummary {
  eurMicros: number;
  /** Priced from provider-reported token counts. */
  measuredEurMicros: number;
  /** Priced from our own token estimate. */
  estimatedEurMicros: number;
  complete: boolean;
  events: number;
  pricedEvents: number;
  unpricedEvents: number;
  failedEvents: number;
  estimatedTokenEvents: number;
  unconvertibleEvents: number;
  tokens: { in: number; cachedIn: number; out: number };
}

/** Internal unit economics for the owner dashboard. Credit value is list price, not revenue; nothing here is net profit. */
export interface AdminEconomics {
  days: number;
  since: string;
  executions: { total: number; completed: number; failed: number; cancelled: number };
  credits: { charged: number; refunded: number; net: number; perCompletedExecution: number | null };
  creditsPerEur: number;
  creditValueEurCents: number;
  creditValueNote: string;
  /** Real money: completed credit-pack purchases in the period. */
  cash: { purchases: number; collectedEurCents: number };
  variableCost: CostSummary;
  overheadCost: CostSummary;
  /** null = not configured (unknown), not zero. */
  fixedCost: { eurCents: number | null; items: Record<string, number> };
  paymentFeesEurCents: number | null;
  costPerCompletedExecutionEurMicros: number | null;
  variableContributionEurCents: number | null;
  variableMarginPct: number | null;
  operatingContributionEurCents: number | null;
  targetMargin: number;
  notNetProfit: string;
  pricing: {
    configuredModels: string[];
    configuredTools: string[];
    fxCurrencies: string[];
    asOf: string | null;
    ageDays: number | null;
    stale: boolean;
    sources: string[];
    fixedCostsConfigured: boolean;
    paymentFeesConfigured: boolean;
    problem: string | null;
  };
  excludedCosts: string[];
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
  ai: {
    providerLabel: string;
    callsToday: number;
    failuresToday: number;
    tokensInToday: number;
    tokensOutToday: number;
    tokensLast14d: DayCount[];
    /** The optional premium model route (server-side configuration). */
    premium?:
      | { configured: false }
      | { configured: boolean; model: string; priced: boolean; pausedFor: string | null; dailyBudgetEur: number | null; spentTodayEurMicros: number | null; purposes: string[] };
  };
  search: { providerLabel: string; callsToday: number; callsThisMonth: number; dailyBudget: number };
  email: { enabled: boolean; sentToday: number };
  /** purchasesCents is real money (EUR cents); demoTopupsCents is credits. */
  money: { purchasesCents: number; purchasesCount: number; demoTopupsCents: number };
  /** Every wallet's balance must equal the sum of its ledger rows. Absent from an older API. */
  ledger?: { walletsChecked: number; mismatches: number; sample: { walletUserId: string; balance: number; ledgerSum: number }[] };
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
  adminEconomics: (days = 30) => request<AdminEconomics>(`/api/admin/economics?days=${days}`),
};
