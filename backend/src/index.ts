import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config, isProduction, productionConfigProblems, productionConfigWarnings } from "./config";
import { prisma } from "./db";

import authRoutes from "./auth/routes";
import guestRoutes from "./guest/routes";
import legacyRoutes from "./legacy/routes";
import workflowRoutes from "./workflows/routes";
import billingRoutes from "./billing/routes";
import teamRoutes from "./team/routes";
import adminRoutes from "./admin/routes";
import publicRoutes from "./public/routes";
import objectiveRoutes from "./api/objectives";
import executionRoutes from "./api/executions";
import approvalRoutes from "./api/approvals";
import exceptionRoutes from "./api/exceptions";
import contextRoutes from "./api/context";
import memoryRoutes from "./api/memory";
import aiTeamRoutes from "./api/aiTeam";
import dashboardRoutes from "./api/dashboard";
import orgRoutes from "./api/org";
import { publicConfig } from "./public/config";
import { stripeWebhookHandler } from "./billing/stripe";
import { ah, errorHandler } from "./lib/http";
import { globalLimiter } from "./lib/rateLimits";
import { log } from "./lib/log";
import { aiProviderLabel } from "./ai/llmProvider";
import { maintenance } from "./engine/maintenance";
import { queueStats } from "./engine/queue";
import { Worker } from "./engine/worker";

const app = express();

// Behind Render's proxy: use X-Forwarded-For so rate limits see real client IPs.
app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
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

// Stripe webhook: needs the RAW body to verify the signature, so it is
// registered before any JSON parser — and before the global rate limiter.
app.post("/api/billing/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), ah(stripeWebhookHandler));

// Liveness: the process is up.
app.get("/health/live", (_req, res) => res.json({ ok: true }));
// Readiness (Render health check): the database answers; queue lag is reported.
app.get(
  "/health",
  ah(async (_req, res) => {
    try {
      await Promise.race([prisma.$queryRaw`SELECT 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))]);
    } catch (err) {
      log.error("health.db_failed", { error: err });
      res.status(503).json({ ok: false, db: "unreachable" });
      return;
    }
    const queue = await queueStats().catch(() => null);
    res.set("Cache-Control", "no-store");
    res.json({ ok: true, db: "ok", queue, degraded: !!queue && queue.oldestQueuedSeconds > 600 });
  })
);

app.use("/api", globalLimiter);

// Company documents carry extracted text: their own larger body limit, BEFORE the global 100kb parser.
app.use("/api/context", express.json({ limit: "400kb" }), contextRoutes);

app.use(express.json({ limit: "100kb" }));

// Public deployment settings so the UI can adapt (PublicConfig in frontend/lib/api.ts).
app.get("/api/config", (_req, res) => {
  res.json(publicConfig());
});

app.use("/api/auth", authRoutes);
app.use("/api/guest", guestRoutes);
app.use("/api/org", orgRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/objectives", objectiveRoutes);
app.use("/api/executions", executionRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/exceptions", exceptionRoutes);
app.use("/api/memory", memoryRoutes);
app.use("/api/ai-team", aiTeamRoutes);
app.use("/api/workflows", workflowRoutes); // recurring objectives
app.use("/api/billing", billingRoutes);
app.use("/api/team", teamRoutes); // organization members (team model)
app.use("/api/tasks", legacyRoutes); // earlier reports (read-only)
app.use("/api/admin", adminRoutes);
app.use("/api/public", publicRoutes);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Last-resort error handler: always `{ error: string }`, never a stack trace.
app.use(errorHandler);

const port = Number(process.env.PORT) || 4000;

/** Run the worker inside the API process? Default on, except in production where a separate worker is recommended. */
export function embeddedWorkerEnabled(): boolean {
  const raw = process.env.EMBEDDED_WORKER?.trim().toLowerCase();
  if (raw) return ["1", "true", "yes", "on"].includes(raw);
  return !isProduction;
}

async function start() {
  const problems = productionConfigProblems();
  if (problems.length) {
    console.error("Refusing to start: the production configuration is unsafe or incomplete.");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  for (const w of productionConfigWarnings()) console.warn(`[config] WARNING: ${w}`);

  const server = app.listen(port, () => {
    log.info("api.listening", { port, ai: aiProviderLabel(), embeddedWorker: embeddedWorkerEnabled() });
    console.log(
      `Optional services — search: ${config.search.provider}, email: ${config.email.enabled ? "on" : "off"}, payments: ${config.stripe.enabled ? "on" : "off"}, guest trial: ${config.guest.enabled ? "on" : "off"}`
    );
  });

  let worker: Worker | null = null;
  if (embeddedWorkerEnabled()) {
    worker = new Worker({ maintenance, maintenanceMs: 30_000 });
    worker.start();
  }

  const shutdown = async (signal: string) => {
    log.info("api.shutdown", { signal });
    server.close();
    if (worker) await worker.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Exported for tests (which set ENSEMBLIS_NO_AUTOSTART=1 to import without listening).
export { app };
if (process.env.ENSEMBLIS_NO_AUTOSTART !== "1") start();
