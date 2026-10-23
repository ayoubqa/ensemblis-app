-- Additive: indexes for the daily planning quota (lib/usageLimits.ts assertPlanningQuotaInTx).
-- Both tables are created by the previous migration, so on first deploy they are empty and this is instant.

-- CreateIndex
CREATE INDEX "Execution_createdAt_idx" ON "Execution"("createdAt");

-- CreateIndex
CREATE INDEX "ExecutionEvent_orgId_type_createdAt_idx" ON "ExecutionEvent"("orgId", "type", "createdAt");

