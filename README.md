# Ensemblis — real backend + frontend

This is the real, deployable version of the Ensemblis demo you saw as a single HTML
artifact. The difference that matters: **the AI work is no longer faked**. The
prototype simulated task execution with timers and canned reports; this version
creates a real account, stores real data in Postgres, and actually calls a real
model to do the work when you start a task.

By default that model is a **free local model running through [Ollama](https://ollama.com)**
— no account, no payment, nothing leaves your machine. Swap one env var
(`AI_PROVIDER=anthropic`) to switch to the real Claude API later, for
noticeably better output quality once you're ready to pay for it.

```
ensemblis-app/
  backend/     Express + TypeScript + Prisma + Postgres API
  frontend/    Next.js (App Router) + Tailwind
  docker-compose.yml   local Postgres for development
```

## What's real here vs. what's still a scaffold

**Real:** accounts and auth (bcrypt + JWT), the role-based sign-up flow (company vs.
developer persona, same idea as the prototype), a Postgres-backed data model for
users/tasks/agents/workflows, and — the important part — tasks that actually call
a real model (`backend/src/tasks/llmProvider.ts`) with an agent's system prompt
and return a real markdown report.

**Still scaffolding, listed so you don't assume otherwise:**
- No payments. Everything uses a `credits` integer on the user row. Wire in Stripe
  before charging anyone for real.
- Tasks run with simple fire-and-forget `async` calls and the frontend polls every
  2 seconds. Fine at low volume; swap in a real job queue (BullMQ + Redis, or a
  hosted queue) once you have enough concurrent tasks that a server restart
  losing an in-flight task would actually matter.
- Workflows (recurring tasks) are run by a simple in-process scheduler that checks
  every minute. With more than one backend instance you'd want a single external
  cron/queue scheduler instead, so a workflow isn't picked up twice.
- No published-agent moderation/review step — a developer's agent goes live the
  moment they publish it.
- The frontend is a clean, working rebuild of the core flows, not a pixel-for-pixel
  port of the prototype's full visual design (the command palette, confetti,
  performance graph, etc. from the HTML version aren't ported). Treat it as the
  real foundation to keep building the experience on top of, with Claude Code.

## Local setup

**1. Database**

```bash
docker compose up -d
```

**2. Ollama (the free AI provider — skip this only if you're using Anthropic instead)**

```bash
# Install from https://ollama.com, then:
ollama pull llama3.2
ollama serve   # the desktop app does this automatically if you installed that way
```

**3. Backend**

```bash
cd backend
cp .env.example .env
# defaults are already set for Ollama — just set JWT_SECRET to any random string
npm install
npx prisma migrate dev --name v3   # creates/updates all tables (fresh DB or an older one)
npm run seed                        # upserts the full 20-agent catalog (safe to re-run)
npm run dev                         # http://localhost:4000
```

Already ran an earlier version? Pull the new code, then from `backend/` run
`npm install && npx prisma migrate dev --name v3 && npm run seed`. The change
only adds a nullable `termsAcceptedAt` column, so existing data is kept.

Optional checks: `npm run typecheck` (TypeScript) and `npm run sanity:classify`
(prints how sample briefs are routed to agent teams, with prices — no DB needed).

How a task runs: `POST /api/tasks/estimate` plans a team (Research → lead
specialist → Verification → Report, depending on depth) and prices it;
`POST /api/tasks` charges credits and runs those agents one after another in the
background, each step a real model call that sees the previous steps' output.
Failed runs are refunded automatically, and tasks interrupted by a server
restart are failed and refunded on the next start. Active workflows are run by
an in-process scheduler (checked every minute) when the user has credits.

**4. Frontend**

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev           # http://localhost:3000
```

Open `http://localhost:3000`, sign up (pick Company or Developer), and start a
task — it actually runs against your local model and shows you a real
generated report. The first run after `ollama pull` may take a little longer
while the model loads into memory.

**Switching to the real Claude API later:** set `AI_PROVIDER="anthropic"` and
`ANTHROPIC_API_KEY="sk-ant-..."` in `backend/.env` (get a key at
[console.anthropic.com](https://console.anthropic.com) — note this requires
adding a payment method; there's no free trial credit at the time of writing).
Nothing else changes — same code, same data model, just a better model behind it.

## Deploying (public demo link)

The free setup this repo is wired for:

| Piece | Host | Notes |
|---|---|---|
| Database | [Neon](https://neon.tech) free Postgres | |
| Backend | [Render](https://render.com) free web service | `render.yaml` at the repo root; sleeps after 15 min idle, first request then takes ~30–60 s |
| AI model | [Groq](https://console.groq.com) free API | via `AI_PROVIDER=openai` (any OpenAI-compatible API works) |
| Frontend | [Vercel](https://vercel.com) | |

**1. Neon.** Create a project (pick a region, e.g. Europe Central / Frankfurt).
Copy the **direct** connection string (Connection details → turn *off*
"Connection pooling"). It must end with `?sslmode=require`. That one URL is all
you need.

**2. Groq.** Create a free API key at [console.groq.com/keys](https://console.groq.com/keys).

**3. Render.** Push the repo to GitHub, then Render → **New → Blueprint** → pick
the repo. It reads `render.yaml` and asks for:
- `DATABASE_URL` — the Neon string from step 1
- `OPENAI_API_KEY` — the Groq key
- `CORS_ORIGIN` — your Vercel URL (fill in after step 4 if you don't have it yet; no trailing slash needed)
- `SIGNUP_INVITE_CODE` — leave empty for open sign-up, or set a code to share only with testers

`JWT_SECRET` is generated for you. Every deploy/boot runs `npm run start:render`:
it syncs the schema with `prisma db push` (adds new tables/columns; it never
drops data — if a change *would* lose data it stops with an error instead),
re-seeds the agent catalog (safe to repeat), then starts the API. Check
`https://<your-service>.onrender.com/health` returns `{"ok":true}`.

**4. Vercel.** Import the repo, set the root directory to `frontend`, and set
two environment variables: `NEXT_PUBLIC_API_URL` = your Render URL, and
`NEXT_PUBLIC_CONTACT_EMAIL` = the address shown on the Privacy and Terms pages
(until it's set those pages show a red placeholder). Then put the Vercel URL into Render's
`CORS_ORIGIN` (Render redeploys automatically).

**Protection built in** (all env vars, documented in `backend/.env.example`;
production values are in `render.yaml`): per-IP rate limits on sign-up, login,
estimates and task runs; a daily task cap per account and for the whole server
(the "kill switch" on your AI bill); a lifetime cap on free demo top-ups; a max
brief length; optional invite code; Terms acceptance at sign-up; and a
concurrency limiter + retries so bursts queue instead of hitting the AI
provider's rate limits. The server refuses to boot in production without a real
`JWT_SECRET` and a `DATABASE_URL`.

**Know the free-tier limits.** Groq's free plan caps tokens per minute and per
day per model (see [console.groq.com/settings/limits](https://console.groq.com/settings/limits)).
A team task makes 2–4 model calls of several thousand tokens each, so the
70B model's daily allowance covers only a modest number of tasks. When it runs
out, tasks fail with "the free AI quota is used up for now" and are refunded
automatically. For more headroom set `OPENAI_MODEL=llama-3.1-8b-instant`
(higher free limits, lower quality) or upgrade to Groq's paid tier.

The `backend/Dockerfile` still works for Docker-based hosts (Fly.io, Railway).
There, run `npx prisma db push` and `npm run seed` against the database yourself.

## Staying connected with Claude for ongoing development

The practical setup:

1. **The code lives on GitHub** (`ayoubqa/ensemblis-app`). Claude pushes changes
   there; on your Mac, `git pull` brings them down.
2. **Keep working with Claude Code against that repo** — either locally (the
   `claude` CLI in your terminal, pointed at this folder) or in a cloud session
   like this one with the repo attached. Either way you get real version control:
   every feature becomes a commit, not a one-off edit to a single file.
3. From there, treat it like a normal engineering backlog. Good next things to ask
   for, in roughly the order they start to matter:
   - Port more of the prototype's UI polish (command palette, dashboard charts,
     settings page) into the real Next.js app, backed by the real API instead of
     fake state.
   - Add Stripe for real payments.
   - Add a job queue for task execution instead of fire-and-forget + polling.
   - Add a scheduler for workflows (a hosted cron hitting a "run now" endpoint).
   - Add tests (the backend's route handlers are straightforward to test with
     something like Vitest + Supertest).
   - Move the per-IP rate limits to Redis if you ever run more than one
     backend instance (they're in-memory, per process, today).

## Why this structure

Frontend and backend are separate so you can deploy, scale, and redeploy them
independently, and so the backend can later serve a mobile app or other clients
without changes. Prisma gives you migrations and type-safe queries instead of
hand-written SQL. None of this is mandatory — a monolith (e.g. Next.js API routes
only, no separate Express app) is a perfectly reasonable alternative that's even
simpler to deploy — but the separate-backend approach scales better once the
agent-execution logic gets more complex (job queues, webhooks, workers).
