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
npx prisma migrate dev --name v2   # creates/updates all tables (fresh DB or one from the old `init` schema)
npm run seed                        # upserts the full 20-agent catalog (safe to re-run)
npm run dev                         # http://localhost:4000
```

Already ran the earlier scaffold? Pull the new code, then from `backend/` run
`npm install && npx prisma migrate dev --name v2 && npm run seed`. The v2
migration only adds tables and nullable/defaulted columns, so existing users,
tasks and workflows are kept.

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

## Deploying

A reasonable, cheap starting setup:

- **Frontend** → [Vercel](https://vercel.com) (it's a Next.js app, so this is a
  near-zero-config deploy). Set `NEXT_PUBLIC_API_URL` to your deployed backend URL.
- **Backend** → [Render](https://render.com), [Railway](https://railway.app), or
  [Fly.io](https://fly.io). All three can build the `backend/Dockerfile` directly
  or run `npm run build && npm start`. Set the same env vars as `.env.example`.
- **Database** → a managed Postgres. [Supabase](https://supabase.com) or
  [Neon](https://neon.tech) both have workable free tiers; point `DATABASE_URL`
  at it and run `npx prisma migrate deploy` once against production.

Once deployed, update the backend's `CORS_ORIGIN` to your real frontend URL.

## Staying connected with Claude for ongoing development

The practical setup:

1. **Push this to a GitHub repo.** Once you connect GitHub in claude.ai (Settings
   → Connectors), I can create the repo and push this scaffold directly next time
   — just ask. Until then, push it yourself: `git init && git add -A && git commit
   -m "Initial scaffold" && git remote add origin <your-repo-url> && git push -u
   origin main`.
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
   - Add rate limiting and basic abuse protection before this is public.

## Why this structure

Frontend and backend are separate so you can deploy, scale, and redeploy them
independently, and so the backend can later serve a mobile app or other clients
without changes. Prisma gives you migrations and type-safe queries instead of
hand-written SQL. None of this is mandatory — a monolith (e.g. Next.js API routes
only, no separate Express app) is a perfectly reasonable alternative that's even
simpler to deploy — but the separate-backend approach scales better once the
agent-execution logic gets more complex (job queues, webhooks, workers).
