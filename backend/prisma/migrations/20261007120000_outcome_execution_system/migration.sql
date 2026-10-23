-- CreateEnum
CREATE TYPE "Autonomy" AS ENUM ('REVIEW_PLAN', 'AUTO_WITHIN_BUDGET');

-- CreateEnum
CREATE TYPE "ObjectiveStatus" AS ENUM ('DRAFT', 'PLANNING', 'PLANNED', 'WAITING_FOR_APPROVAL', 'RUNNING', 'BLOCKED', 'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PLANNING', 'PLANNED', 'WAITING_FOR_APPROVAL', 'RUNNING', 'BLOCKED', 'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExecutionStepStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OutcomeStatus" AS ENUM ('ACHIEVED', 'PARTIALLY_ACHIEVED', 'NOT_ACHIEVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CriterionResult" AS ENUM ('MET', 'PARTIALLY_MET', 'NOT_MET', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PASS', 'PASS_WITH_WARNINGS', 'FAIL');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'UNCITED', 'ESTIMATE');

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('PLAN', 'BUDGET', 'ACTION');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ExceptionKind" AS ENUM ('MISSING_INFORMATION', 'STEP_FAILED', 'VERIFICATION_FAILED', 'INSUFFICIENT_FUNDS', 'POLICY_BLOCKED');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('WEB', 'WIKIPEDIA', 'DOCUMENT', 'COMPANY_CONTEXT', 'WEBSITE', 'CALCULATION', 'TOOL_OUTPUT', 'ARTIFACT');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('PREFERENCE', 'DECISION', 'LESSON', 'CONSTRAINT', 'FACT');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('ACTIVE', 'PENDING_CONFIRMATION', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'DEAD');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "autonomy" "Autonomy",
ADD COLUMN     "budgetCents" INTEGER,
ADD COLUMN     "lastObjectiveId" TEXT,
ADD COLUMN     "successCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "executionId" TEXT;

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "executionId" TEXT,
ADD COLUMN     "latencyMs" INTEGER;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "teamId" TEXT,
    "defaultAutonomy" "Autonomy" NOT NULL DEFAULT 'REVIEW_PLAN',
    "approvalThresholdCents" INTEGER NOT NULL DEFAULT 2000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyContext" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "products" TEXT NOT NULL DEFAULT '',
    "businessModel" TEXT NOT NULL DEFAULT '',
    "customers" TEXT NOT NULL DEFAULT '',
    "markets" TEXT NOT NULL DEFAULT '',
    "goals" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "websiteSummary" TEXT NOT NULL DEFAULT '',
    "websiteFetchedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "charCount" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Objective" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdById" TEXT,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "contextNotes" TEXT NOT NULL DEFAULT '',
    "deadline" TIMESTAMP(3),
    "budgetCents" INTEGER NOT NULL,
    "autonomy" "Autonomy" NOT NULL DEFAULT 'REVIEW_PLAN',
    "status" "ObjectiveStatus" NOT NULL DEFAULT 'DRAFT',
    "outcomeStatus" "OutcomeStatus",
    "workflowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Objective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuccessCriterion" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'qualitative',
    "targetValue" DOUBLE PRECISION,
    "unit" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuccessCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PLANNING',
    "triggeredById" TEXT,
    "plan" JSONB,
    "planSource" TEXT,
    "plannerVersion" TEXT,
    "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "walletUserId" TEXT,
    "chargedAt" TIMESTAMP(3),
    "result" TEXT,
    "summary" TEXT,
    "verificationStatus" "VerificationStatus",
    "verificationScore" INTEGER,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "outcomeStatus" "OutcomeStatus",
    "outcomeSummary" TEXT,
    "outcomeConfirmedById" TEXT,
    "outcomeConfirmedAt" TIMESTAMP(3),
    "estimatedManualHours" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "shareToken" TEXT,
    "sharedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastProgressAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionStep" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "executive" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "capabilityVersion" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "dependsOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inputs" JSONB NOT NULL DEFAULT '[]',
    "outputs" JSONB NOT NULL DEFAULT '[]',
    "verification" JSONB NOT NULL DEFAULT '[]',
    "kind" TEXT NOT NULL DEFAULT 'work',
    "status" "ExecutionStepStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "output" TEXT,
    "partialOutput" TEXT,
    "summary" TEXT,
    "error" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "notBefore" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExecutionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionEvent" (
    "id" SERIAL NOT NULL,
    "executionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "stepId" TEXT,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "kind" "ApprovalKind" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "proposedAction" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "risk" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "recommendation" TEXT NOT NULL,
    "recommendedDecision" TEXT NOT NULL DEFAULT 'APPROVE',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exception" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepId" TEXT,
    "kind" "ExceptionKind" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "whatHappened" TEXT NOT NULL,
    "whyItMatters" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "neededFromUser" TEXT NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "actions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolution" TEXT,
    "resolvedAction" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepId" TEXT,
    "n" INTEGER NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "domain" TEXT,
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "publishedAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "status" "VerificationStatus" NOT NULL,
    "score" INTEGER NOT NULL,
    "checks" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "humanJudgment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assessment" JSONB,
    "method" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimCheck" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "claim" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL,
    "evidenceNs" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "supportScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ClaimCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutcomeMeasurement" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "result" "CriterionResult" NOT NULL,
    "measuredValue" DOUBLE PRECISION,
    "measurement" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutcomeMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "status" "MemoryStatus" NOT NULL,
    "content" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "sourceExecutionId" TEXT,
    "createdById" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValueRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "executionId" TEXT,
    "objectiveId" TEXT,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "isEstimate" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValueRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_ownerId_key" ON "Organization"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_teamId_key" ON "Organization"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyContext_orgId_key" ON "CompanyContext"("orgId");

-- CreateIndex
CREATE INDEX "ContextDocument_orgId_createdAt_idx" ON "ContextDocument"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Objective_orgId_createdAt_idx" ON "Objective"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Objective_orgId_status_idx" ON "Objective"("orgId", "status");

-- CreateIndex
CREATE INDEX "SuccessCriterion_objectiveId_order_idx" ON "SuccessCriterion"("objectiveId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Execution_shareToken_key" ON "Execution"("shareToken");

-- CreateIndex
CREATE INDEX "Execution_orgId_createdAt_idx" ON "Execution"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Execution_objectiveId_attempt_idx" ON "Execution"("objectiveId", "attempt");

-- CreateIndex
CREATE INDEX "Execution_status_lastProgressAt_idx" ON "Execution"("status", "lastProgressAt");

-- CreateIndex
CREATE INDEX "ExecutionStep_executionId_order_idx" ON "ExecutionStep"("executionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionStep_executionId_key_key" ON "ExecutionStep"("executionId", "key");

-- CreateIndex
CREATE INDEX "ExecutionEvent_executionId_id_idx" ON "ExecutionEvent"("executionId", "id");

-- CreateIndex
CREATE INDEX "ExecutionEvent_orgId_id_idx" ON "ExecutionEvent"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_status_lockedUntil_idx" ON "Job"("status", "lockedUntil");

-- CreateIndex
CREATE INDEX "Approval_orgId_status_createdAt_idx" ON "Approval"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_executionId_idx" ON "Approval"("executionId");

-- CreateIndex
CREATE INDEX "Exception_orgId_status_createdAt_idx" ON "Exception"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Exception_executionId_idx" ON "Exception"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_executionId_n_key" ON "Evidence"("executionId", "n");

-- CreateIndex
CREATE INDEX "Verification_executionId_round_idx" ON "Verification"("executionId", "round");

-- CreateIndex
CREATE INDEX "ClaimCheck_verificationId_order_idx" ON "ClaimCheck"("verificationId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "OutcomeMeasurement_executionId_criterionId_key" ON "OutcomeMeasurement"("executionId", "criterionId");

-- CreateIndex
CREATE INDEX "MemoryItem_orgId_status_idx" ON "MemoryItem"("orgId", "status");

-- CreateIndex
CREATE INDEX "ValueRecord_orgId_metric_createdAt_idx" ON "ValueRecord"("orgId", "metric", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerification_tokenHash_key" ON "EmailVerification"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerification_userId_createdAt_idx" ON "EmailVerification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_executionId_idx" ON "Transaction"("executionId");

-- CreateIndex
CREATE INDEX "UsageEvent_executionId_idx" ON "UsageEvent"("executionId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyContext" ADD CONSTRAINT "CompanyContext_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextDocument" ADD CONSTRAINT "ContextDocument_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessCriterion" ADD CONSTRAINT "SuccessCriterion_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionStep" ADD CONSTRAINT "ExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionEvent" ADD CONSTRAINT "ExecutionEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionEvent" ADD CONSTRAINT "ExecutionEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionEvent" ADD CONSTRAINT "ExecutionEvent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ExecutionStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ExecutionStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimCheck" ADD CONSTRAINT "ClaimCheck_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeMeasurement" ADD CONSTRAINT "OutcomeMeasurement_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeMeasurement" ADD CONSTRAINT "OutcomeMeasurement_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "SuccessCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryItem" ADD CONSTRAINT "MemoryItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryItem" ADD CONSTRAINT "MemoryItem_sourceExecutionId_fkey" FOREIGN KEY ("sourceExecutionId") REFERENCES "Execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueRecord" ADD CONSTRAINT "ValueRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueRecord" ADD CONSTRAINT "ValueRecord_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

