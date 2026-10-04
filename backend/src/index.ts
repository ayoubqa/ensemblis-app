import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config, productionConfigProblems, productionConfigWarnings } from "./config";

import authRoutes from "./auth/routes";
import taskRoutes from "./tasks/routes";
import agentRoutes from "./agents/routes";
import workflowRoutes from "./workflows/routes";
import workforceRoutes from "./workforce/routes";
import billingRoutes from "./billing/routes";
import statsRoutes from "./stats/routes";
import developerRoutes from "./developer/routes";
import { errorHandler } from "./lib/http";
import { globalLimiter } from "./lib/rateLimits";
import { aiProviderLabel } from "./tasks/llmProvider";
import { recoverInterruptedTasks } from "./tasks/service";
import { startScheduler } from "./workflows/schedule";

const app = express();

// Behind Render's proxy: use X-Forwarded-For so rate limits see real client IPs.
app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");

app.use(
  helmet({
    // This is a JSON API called cross-origin by the frontend.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin: (origin, cb) => {
      // No Origin header = same-origin, curl, health checks: allow.
      if (!origin) return cb(null, true);
      cb(null, config.corsOrigins.includes(origin.replace(/\/+$/, "")));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", globalLimiter);

// Public deployment settings so the UI can adapt (PublicConfig in frontend/lib/api.ts).
app.get("/api/config", (_req, res) => {
  res.json({
    demoMode: config.demoMode,
    inviteRequired: !!config.signupInviteCode,
    topupEnabled: config.topupEnabled && config.topupMaxCents > 0,
    topupMaxCents: config.topupEnabled ? config.topupMaxCents : 0,
    startingCreditsCents: config.startingCreditsCents,
    maxTasksPerUserPerDay: config.maxTasksPerUserPerDay,
    maxDescriptionLength: config.maxDescriptionLength,
    aiProviderLabel: aiProviderLabel(),
    sampleCatalogStats: true, // catalog ratings/success rates/task counts are seeded sample data
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/api/workforce", workforceRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/developer", developerRoutes);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Last-resort error handler: always `{ error: string }`, never a stack trace.
app.use(errorHandler);

const port = Number(process.env.PORT) || 4000;

async function start() {
  // Fail fast (before anything touches the DB) on unsafe production settings.
  const problems = productionConfigProblems();
  if (problems.length) {
    console.error("Refusing to start: the production configuration is unsafe or incomplete.");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  for (const w of productionConfigWarnings()) console.warn(`[config] WARNING: ${w}`);

  // Runs are in-process, so anything still RUNNING was interrupted by a restart.
  await recoverInterruptedTasks().catch((err) => console.error("Startup task recovery failed:", err));

  app.listen(port, () => {
    console.log(`Ensemblis API listening on port ${port} (AI: ${aiProviderLabel()}, demo mode: ${config.demoMode})`);
  });

  if (process.env.DISABLE_SCHEDULER !== "true") {
    startScheduler(Number(process.env.SCHEDULER_INTERVAL_MS) || 60_000);
  }
}

start();
