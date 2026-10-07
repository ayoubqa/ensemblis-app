import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config, productionConfigProblems, productionConfigWarnings } from "./config";

import authRoutes from "./auth/routes";
import guestRoutes from "./guest/routes";
import taskRoutes from "./tasks/routes";
import researchRoutes from "./tasks/researchRoutes";
import attachmentRoutes from "./attachments/routes";
import agentRoutes from "./agents/routes";
import workflowRoutes from "./workflows/routes";
import workforceRoutes from "./workforce/routes";
import billingRoutes from "./billing/routes";
import statsRoutes from "./stats/routes";
import developerRoutes from "./developer/routes";
import teamRoutes from "./team/routes";
import adminRoutes from "./admin/routes";
import galleryRoutes from "./gallery/routes";
import publicRoutes from "./public/routes";
import { publicConfig } from "./public/config";
import { stripeWebhookHandler } from "./billing/stripe";
import { ah, errorHandler } from "./lib/http";
import { globalLimiter } from "./lib/rateLimits";
import { aiProviderLabel } from "./tasks/llmProvider";
import { recoverInterruptedTasks } from "./tasks/service";
import { recoverInterruptedRevisions } from "./tasks/revisions";
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

// Stripe webhook (v3): needs the RAW body to verify the signature, so it is
// registered before any JSON parser — and before the global rate limiter,
// so Stripe's retries are never throttled.
app.post("/api/billing/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), ah(stripeWebhookHandler));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", globalLimiter);

// Attachments carry extracted document text: their own larger body limit,
// registered BEFORE the global 100kb parser.
app.use("/api/attachments", express.json({ limit: "400kb" }), attachmentRoutes);

app.use(express.json({ limit: "100kb" }));

// Public deployment settings so the UI can adapt (PublicConfig in frontend/lib/api.ts).
app.get("/api/config", (_req, res) => {
  res.json(publicConfig());
});

app.use("/api/auth", authRoutes);
app.use("/api/guest", guestRoutes);
// Both task routers share /api/tasks; tasks/routes.ts applies auth per route
// so requests it doesn't handle fall through to the research routes.
app.use("/api/tasks", taskRoutes);
app.use("/api/tasks", researchRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/api/workforce", workforceRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/developer", developerRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/gallery", galleryRoutes);
app.use("/api/public", publicRoutes);

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
  await recoverInterruptedRevisions().catch((err) => console.error("Startup revision recovery failed:", err));

  app.listen(port, () => {
    console.log(`Ensemblis API listening on port ${port} (AI: ${aiProviderLabel()}, demo mode: ${config.demoMode})`);
    const optional = [
      `search: ${config.search.provider}`,
      `email: ${config.email.enabled ? "on" : "off"}`,
      `payments: ${config.stripe.enabled ? "on" : "off"}`,
      `guest trial: ${config.guest.enabled ? "on" : "off"}`,
      `bot check: ${config.turnstile.enabled ? "on" : "off"}`,
      `admins: ${config.adminEmails.length}`,
    ];
    console.log(`Optional services — ${optional.join(", ")}`);
  });

  if (process.env.DISABLE_SCHEDULER !== "true") {
    startScheduler(Number(process.env.SCHEDULER_INTERVAL_MS) || 60_000);
  }
}

// Exported for tests (which set ENSEMBLIS_NO_AUTOSTART=1 to import without listening).
export { app };
if (process.env.ENSEMBLIS_NO_AUTOSTART !== "1") start();
