-- Activation funnel by signup week (read-only). Guests excluded.
WITH users AS (
  SELECT id, date_trunc('week', "createdAt") AS cohort
  FROM "User"
  WHERE NOT "isGuest"
),
first_objective AS (
  SELECT "createdById" AS uid, min("createdAt") AS at
  FROM "Objective"
  WHERE "createdById" IS NOT NULL
  GROUP BY 1
),
executions AS (
  SELECT o."createdById" AS uid,
         min(e."startedAt")                                                                  AS first_started,
         min(e."completedAt") FILTER (WHERE e.status = 'COMPLETED')                          AS first_completed,
         min(e."completedAt") FILTER (WHERE e."verificationStatus" IN ('PASS', 'PASS_WITH_WARNINGS')) AS first_verified,
         min(e."completedAt") FILTER (WHERE e."confirmedOutcomeStatus" IS NOT NULL)          AS first_confirmed,
         count(DISTINCT date_trunc('week', e."createdAt"))                                   AS active_weeks
  FROM "Execution" e
  JOIN "Objective" o ON o.id = e."objectiveId"
  WHERE o."createdById" IS NOT NULL
  GROUP BY 1
)
SELECT u.cohort::date                                         AS signup_week,
       count(*)                                               AS signups,
       count(fo.uid)                                          AS created_objective,
       count(x.first_started)                                 AS started_execution,
       count(x.first_completed)                               AS completed_execution,
       count(x.first_verified)                                AS verified_result,
       count(x.first_confirmed)                               AS outcome_confirmed,
       count(*) FILTER (WHERE x.active_weeks >= 2)            AS came_back_another_week
FROM users u
LEFT JOIN first_objective fo ON fo.uid = u.id
LEFT JOIN executions x ON x.uid = u.id
GROUP BY 1
ORDER BY 1 DESC;
