import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./auth/routes";
import taskRoutes from "./tasks/routes";
import agentRoutes from "./agents/routes";
import workflowRoutes from "./workflows/routes";
import workforceRoutes from "./workforce/routes";
import billingRoutes from "./billing/routes";
import statsRoutes from "./stats/routes";
import developerRoutes from "./developer/routes";
import { errorHandler } from "./lib/http";
import { recoverInterruptedTasks } from "./tasks/service";
import { startScheduler } from "./workflows/schedule";

const app = express();

app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map((s) => s.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

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
  // Runs are in-process, so anything still RUNNING was interrupted by a restart.
  await recoverInterruptedTasks().catch((err) => console.error("Startup task recovery failed:", err));

  app.listen(port, () => {
    console.log(`Ensemblis API listening on http://localhost:${port}`);
  });

  if (process.env.DISABLE_SCHEDULER !== "true") {
    startScheduler(Number(process.env.SCHEDULER_INTERVAL_MS) || 60_000);
  }
}

start();
