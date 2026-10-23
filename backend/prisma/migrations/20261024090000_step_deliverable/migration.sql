-- Additive: the deliverable check of a completed step (engine/stepChecks.ts).
-- Nullable, no default, no backfill: steps completed before this release show
-- no deliverable verdict, and an older build ignores the column.
ALTER TABLE "ExecutionStep" ADD COLUMN "deliverable" JSONB;
