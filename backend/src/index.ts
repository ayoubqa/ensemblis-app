import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./auth/routes";
import taskRoutes from "./tasks/routes";
import agentRoutes from "./agents/routes";
import workflowRoutes from "./workflows/routes";

const app = express();

app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),
    credentials: true,
  })
);
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/workflows", workflowRoutes);

// Last-resort error handler so a thrown error returns JSON, not a stack trace.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Ensemblis API listening on http://localhost:${port}`);
});
