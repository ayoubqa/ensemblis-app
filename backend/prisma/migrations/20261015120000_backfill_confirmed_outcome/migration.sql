-- Data only (no schema change). Before 20261014120000_real_execution_v1 a person's confirmation
-- overwrote "outcomeStatus" and set "outcomeConfirmedAt"; since then it is stored in
-- "confirmedOutcomeStatus". Carry those earlier confirmations over, so lists, the dashboard and
-- the shared report show them as confirmed rather than AI-assessed. Idempotent.
UPDATE "Execution"
SET "confirmedOutcomeStatus" = "outcomeStatus"
WHERE "outcomeConfirmedAt" IS NOT NULL
  AND "confirmedOutcomeStatus" IS NULL
  AND "outcomeStatus" IS NOT NULL;
