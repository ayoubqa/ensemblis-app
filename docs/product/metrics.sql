-- Commercial outcome metrics by month (read-only; run in Neon's SQL editor). Guests excluded.
-- Definitions: docs/product/phase4-strategy.md § Measurement. Small numbers are counts, not rates.
--
--   executions_started     executions charged and started (startedAt set)
--   completed              COMPLETED (a result was delivered, verified or not)
--   verified               completed with verification PASS or PASS_WITH_WARNINGS
--   failed_or_cancelled    FAILED or CANCELLED (credits refunded by the engine)
--   completion_rate        completed / started
--   median_minutes_to_result   startedAt → completedAt, completed only
--   net_credits            credits charged − refunded (list value, not revenue while credits are free)
--   priced_cost_eur/_usd   variable provider cost of priced usage events, in the provider's currency (prices are
--                          configured in PROVIDER_PRICING; the EUR rate lives there too, not in the database).
--                          Unpriced events are not counted (see unpriced_events): the true cost is at least this
--   cost_per_completed_eur priced EUR cost / completed (add the USD column at the configured rate when both appear)
--   web_research_steps     steps that ran web research; live_web_steps: of those, answered by Tavily
--   accepted               a person confirmed the outcome (ACHIEVED or PARTIALLY_ACHIEVED) — the closest stored
--                          signal of "the user accepted the deliverable"
--   repeat_orgs            organizations with executions in at least two different weeks of the month
WITH ex AS (
  SELECT e.*,
         date_trunc('month', e."startedAt") AS month
  FROM "Execution" e
  JOIN "Organization" org ON org.id = e."orgId"
  JOIN "User" owner ON owner.id = org."ownerId"
  WHERE e."startedAt" IS NOT NULL AND NOT owner."isGuest"
),
cost AS (
  SELECT u."executionId",
         sum(CASE WHEN u."costCurrency" = 'EUR' THEN u."costMicros" END) / 1e6 AS eur_known,
         sum(CASE WHEN u."costCurrency" = 'USD' THEN u."costMicros" END) / 1e6 AS usd_known,
         count(*) FILTER (WHERE u."costMicros" IS NULL AND u.ok)              AS unpriced
  FROM "UsageEvent" u
  WHERE u."executionId" IS NOT NULL
  GROUP BY 1
),
research AS (
  SELECT s."executionId",
         count(*) FILTER (WHERE s."researchStatus" IS NOT NULL AND s.status <> 'SKIPPED')            AS web_steps,
         count(*) FILTER (WHERE s."researchStatus" IS NOT NULL AND s.status <> 'SKIPPED'
                            AND s.research -> 'providersUsed' ? 'tavily')                              AS live_steps
  FROM "ExecutionStep" s
  GROUP BY 1
),
weeks AS (
  SELECT month, "orgId", count(DISTINCT date_trunc('week', "startedAt")) AS active_weeks
  FROM ex GROUP BY 1, 2
)
SELECT ex.month::date                                                                          AS month,
       count(*)                                                                                AS executions_started,
       count(*) FILTER (WHERE ex.status = 'COMPLETED')                                          AS completed,
       count(*) FILTER (WHERE ex.status = 'COMPLETED' AND ex."verificationStatus" IN ('PASS', 'PASS_WITH_WARNINGS')) AS verified,
       count(*) FILTER (WHERE ex.status IN ('FAILED', 'CANCELLED'))                             AS failed_or_cancelled,
       round(count(*) FILTER (WHERE ex.status = 'COMPLETED')::numeric / nullif(count(*), 0), 2)  AS completion_rate,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ex."completedAt" - ex."startedAt") / 60)
              FILTER (WHERE ex.status = 'COMPLETED'))::numeric, 1)                               AS median_minutes_to_result,
       sum(ex."costCents" - ex."refundedCents")                                                 AS net_credits,
       round(sum(c.eur_known)::numeric, 4)                                                       AS priced_cost_eur,
       round(sum(c.usd_known)::numeric, 4)                                                       AS priced_cost_usd,
       coalesce(sum(c.unpriced), 0)                                                             AS unpriced_events,
       round((sum(c.eur_known) / nullif(count(*) FILTER (WHERE ex.status = 'COMPLETED'), 0))::numeric, 4) AS cost_per_completed_eur,
       coalesce(sum(r.web_steps), 0)                                                            AS web_research_steps,
       coalesce(sum(r.live_steps), 0)                                                           AS live_web_steps,
       count(*) FILTER (WHERE ex."confirmedOutcomeStatus" IN ('ACHIEVED', 'PARTIALLY_ACHIEVED')) AS accepted,
       count(*) FILTER (WHERE ex."confirmedOutcomeStatus" IS NOT NULL)                          AS outcome_judged,
       (SELECT count(*) FROM weeks w WHERE w.month = ex.month AND w.active_weeks >= 2)           AS repeat_orgs
FROM ex
LEFT JOIN cost c ON c."executionId" = ex.id
LEFT JOIN research r ON r."executionId" = ex.id
GROUP BY ex.month
ORDER BY ex.month DESC;
