import { afterAll, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { setLLMHandlerForTests } from "../src/ai/llmProvider";

const TABLES = [
  "ClaimCheck", "Verification", "OutcomeMeasurement", "Evidence", "ExecutionEvent", "ExecutionStep", "Approval", "Exception",
  "MemoryItem", "ValueRecord", "Transaction", "UsageEvent", "Execution", "SuccessCriterion", "Objective", "ContextDocument",
  "CompanyContext", "Organization", "Job", "EmailVerification", "TaskSource", "TaskStep", "TaskRevision", "TaskAttachment",
  "GalleryItem", "Task", "Workflow", "WorkforceMember", "Agent", "TeamInvite", "TeamMember", "Team", "TeamSeat",
  "PasswordReset", "StripePayment", "User",
];

beforeEach(async () => {
  setLLMHandlerForTests(null);
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
