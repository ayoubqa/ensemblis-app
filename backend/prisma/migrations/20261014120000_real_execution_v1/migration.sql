-- AlterEnum
ALTER TYPE "ExceptionKind" ADD VALUE 'PROVIDER_UNAVAILABLE';

-- AlterEnum
ALTER TYPE "VerificationStatus" ADD VALUE 'UNVERIFIED';

-- AlterTable
ALTER TABLE "ClaimCheck" ADD COLUMN     "claimType" TEXT,
ADD COLUMN     "quote" TEXT;

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "query" TEXT,
ADD COLUMN     "retrieval" TEXT,
ADD COLUMN     "retrievedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Execution" ADD COLUMN     "confirmedOutcomeStatus" "OutcomeStatus";

-- AlterTable
ALTER TABLE "ExecutionStep" ADD COLUMN     "research" JSONB,
ADD COLUMN     "researchStatus" TEXT,
ADD COLUMN     "tokensEstimated" BOOLEAN;

-- AlterTable
ALTER TABLE "Objective" ADD COLUMN     "constraints" TEXT,
ADD COLUMN     "kind" TEXT;

-- AlterTable
ALTER TABLE "OutcomeMeasurement" ADD COLUMN     "evidenceNs" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "UsageEvent" ADD COLUMN     "error" TEXT,
ADD COLUMN     "estimated" BOOLEAN,
ADD COLUMN     "purpose" TEXT;

-- AlterTable
ALTER TABLE "Verification" ADD COLUMN     "assessorError" TEXT,
ADD COLUMN     "modelName" TEXT,
ADD COLUMN     "modelProvider" TEXT;

