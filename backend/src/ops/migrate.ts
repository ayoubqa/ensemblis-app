// Production schema deployment — `npm run migrate:deploy` (node dist/ops/migrate.js).
// Runs before the API starts. It replaces the old `prisma db push` boot step.
//
//   1. Baseline: databases created by the old boot (`prisma db push`) have the
//      v3 tables but no record of migration 0_init — no `_prisma_migrations`
//      table, or one left by a local `prisma migrate dev` with other names.
//      0_init (generated from exactly that v3 schema) is recorded as already
//      applied (`prisma migrate resolve --applied 0_init`). Nothing is changed.
//   2. Recovery: Prisma applies each migration in a transaction, so a migration
//      recorded as failed (crash, lost connection, timeout) changed nothing.
//      It is marked rolled back and `migrate deploy` is retried once, instead
//      of every boot stopping on P3009 until someone intervenes by hand.
//   3. Nothing pending: when every migration this release ships is already
//      recorded as applied, `migrate deploy` would do nothing — but it would
//      still take Prisma's session-level advisory lock, and a restart, an
//      environment-variable change or a code-only deploy would then fail with
//      P1002 whenever that lock is busy (a pooled connection, another deploy).
//      So it is not run at all.
//   4. `prisma migrate deploy` applies every pending migration in order. All
//      migrations after 0_init are additive (new tables, nullable/defaulted
//      columns), so existing rows are kept. A lock or connection error is
//      retried a bounded number of times (the pending list is re-read before
//      each try, so a process that lost a race finds nothing left to do); after
//      the last attempt the boot fails with a clear message and exit code 1, so
//      the API never starts on a schema it was not built for.
//
// DIRECT_URL (optional): a direct (non-pooled) connection string used for the
// steps above instead of DATABASE_URL. The app itself keeps using DATABASE_URL.
// Prisma's migration lock is a session-level advisory lock, which does not work
// reliably through a connection pooler (Neon's "-pooler" hosts, PgBouncer).
//
// Safe to run repeatedly and from several processes at once (Prisma takes an
// advisory lock during `migrate deploy`; a lost baseline race is detected and
// ignored). Never disables that lock, never uses --accept-data-loss and never
// runs `db push`.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const BASELINE = "0_init";
/** Tables the v3 schema (= 0_init) created. A db-push database missing any of them predates v3. */
const V3_TABLES = ["User", "Task", "Transaction", "TaskSource", "TaskRevision", "StripePayment", "UsageEvent", "GalleryItem", "Team"];
/** A table only migrations after 0_init create: present without a recorded 0_init means the schema came from elsewhere. */
const V4_MARKER = "Organization";

const schemaPath = path.resolve(__dirname, "../../prisma/schema.prisma");
const migrationsDir = path.resolve(__dirname, "../../prisma/migrations");

// ---------------------------------------------------------------- connection

export interface MigrationTarget {
  url: string;
  source: "DIRECT_URL" | "DATABASE_URL";
  /** A connection pooler (Neon "-pooler" host, PgBouncer): unreliable for Prisma's migration lock. */
  pooled: boolean;
}

/** Which connection the migration steps use. Never includes the URL in an error message: it holds the password. */
export function resolveMigrationTarget(env: NodeJS.ProcessEnv = process.env): MigrationTarget {
  const direct = env.DIRECT_URL?.trim();
  const source = direct ? "DIRECT_URL" : "DATABASE_URL";
  const url = direct || env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${source} is not a valid connection URL (expected postgresql://user:password@host/database).`);
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error(`${source} must start with postgresql:// (found "${parsed.protocol}//").`);
  }
  const pooled = /-pooler(\.|$)/i.test(parsed.hostname) || parsed.searchParams.get("pgbouncer") === "true";
  return { url, source, pooled };
}

// ------------------------------------------------------------ prisma CLI runner

export interface CliResult {
  ok: boolean;
  output: string;
}

const OUTPUT_CAP = 200_000;

/** Runs the Prisma CLI, echoing its output live and keeping it to classify a failure. */
function prismaCli(args: string[], url: string): Promise<CliResult> {
  const cli = require.resolve("prisma/build/index.js");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args, "--schema", schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: ["inherit", "pipe", "pipe"],
    });
    let output = "";
    const keep = (sink: NodeJS.WriteStream) => (chunk: Buffer) => {
      sink.write(chunk);
      output = (output + chunk.toString()).slice(-OUTPUT_CAP);
    };
    child.stdout.on("data", keep(process.stdout));
    child.stderr.on("data", keep(process.stderr));
    child.on("error", (err) => resolve({ ok: false, output: output + String(err) }));
    child.on("close", (code) => resolve({ ok: code === 0, output }));
  });
}

async function prismaCliOrThrow(args: string[], url: string) {
  const r = await prismaCli(args, url);
  if (!r.ok) throw new Error(`prisma ${args.slice(0, 2).join(" ")} failed`);
}

// ------------------------------------------------------------ failure classes

export type FailureKind = "lock-timeout" | "connection" | "migration";

/**
 * What a failed `migrate deploy` was. Lock timeouts and lost connections are
 * transient; anything else (a migration's own SQL error, a checksum or history
 * problem) is not and is never retried blindly.
 */
export function classifyFailure(output: string): FailureKind {
  if (/\bP1002\b|advisory lock/i.test(output)) return "lock-timeout";
  if (/\bP1001\b|\bP1017\b|Can't reach database server|Server has closed the connection/i.test(output)) return "connection";
  return "migration";
}

export class MigrationFailedError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly attempts: number
  ) {
    super(message);
    this.name = "MigrationFailedError";
  }
}

// ------------------------------------------------------------ retry orchestration

export interface DeployDeps {
  /** Local migrations not yet recorded as applied, read fresh from the database. */
  pending(): Promise<string[]>;
  /** One `prisma migrate deploy`. */
  deploy(): Promise<CliResult>;
  /** Marks migrations recorded as failed as rolled back; returns their names. */
  clearFailed(): Promise<string[]>;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
}

export interface DeployOptions {
  maxAttempts: number;
  retryDelayMs: number;
}

/**
 * Applies pending migrations, if any.
 *  - nothing pending → `deploy` is never called (no lock taken);
 *  - a failure that left a failed-migration record → the record is cleared and
 *    the deploy retried once (the migration ran in a transaction: nothing applied);
 *  - a lock timeout or lost connection → retried after a pause, up to maxAttempts;
 *    the pending list is re-read first, so another process finishing the work
 *    ends this one without a deploy;
 *  - anything else → fails at once.
 */
export async function applyPendingMigrations(deps: DeployDeps, opts: DeployOptions): Promise<{ attempts: number; applied: string[] }> {
  let clearedOnce = false;
  let attempts = 0;
  let lastPending: string[] = [];
  for (;;) {
    lastPending = await deps.pending();
    if (!lastPending.length) {
      deps.log(attempts ? "no pending migrations left (another process applied them) — nothing to do" : "no pending migrations — skipping `prisma migrate deploy` (and its advisory lock)");
      return { attempts, applied: [] };
    }
    attempts++;
    deps.log(`applying ${lastPending.length} pending migration${lastPending.length === 1 ? "" : "s"}: ${lastPending.join(", ")}${opts.maxAttempts > 1 ? ` (attempt ${attempts} of ${opts.maxAttempts})` : ""}`);
    const r = await deps.deploy();
    if (r.ok) return { attempts, applied: lastPending };

    const kind = classifyFailure(r.output);
    if (!clearedOnce || kind !== "migration") {
      const cleared = await deps.clearFailed();
      if (cleared.length && !clearedOnce) {
        clearedOnce = true;
        deps.log("retrying once");
        continue;
      }
    }
    if (kind !== "migration" && attempts < opts.maxAttempts) {
      const wait = opts.retryDelayMs * attempts;
      deps.log(`${kind === "lock-timeout" ? "could not get Prisma's migration lock in time" : "lost the database connection"} — trying again in ${Math.round(wait / 1000)}s`);
      await deps.sleep(wait);
      continue;
    }
    throw new MigrationFailedError(failureMessage(kind, attempts), kind, attempts);
  }
}

function failureMessage(kind: FailureKind, attempts: number): string {
  const tries = `${attempts} attempt${attempts === 1 ? "" : "s"}`;
  if (kind === "lock-timeout") {
    return (
      `Prisma's migration lock (advisory lock 72707369) could not be acquired after ${tries}, and migrations are pending, so the API was not started. ` +
      "Common causes: DATABASE_URL (or DIRECT_URL) is a connection POOLER — set DIRECT_URL to the direct, non-pooled connection string; " +
      "or another deploy / `prisma migrate` session is holding the lock right now (see DEPLOYMENT.md, \"Deploy fails with P1002\"). Nothing was applied."
    );
  }
  if (kind === "connection") return `The database connection was lost or unreachable during \`prisma migrate deploy\` (${tries}); migrations are pending, so the API was not started.`;
  return `\`prisma migrate deploy\` failed (see the Prisma output above); the API was not started. Nothing was retried: this is not a lock or connection error.`;
}

// ------------------------------------------------------------ database state

async function tableExists(prisma: PrismaClient, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT to_regclass('public."${table.replace(/"/g, "")}"') IS NOT NULL AS "exists"`
  );
  return !!rows[0]?.exists;
}

export interface MigrationRow {
  name: string;
  finished: boolean;
  rolledBack: boolean;
}

async function migrationRows(prisma: PrismaClient): Promise<MigrationRow[]> {
  if (!(await tableExists(prisma, "_prisma_migrations"))) return [];
  const rows = await prisma.$queryRawUnsafe<{ migration_name: string; finished: boolean; rolled_back: boolean }[]>(
    `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations"`
  );
  return rows.map((r) => ({ name: r.migration_name, finished: r.finished, rolledBack: r.rolled_back }));
}

const baselineRecorded = (rows: MigrationRow[]) => rows.some((r) => r.name === BASELINE && r.finished && !r.rolledBack);

function localMigrationNames(): string[] {
  return fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

/** Migrations this release ships that are not recorded as applied (finished and not rolled back). */
export function pendingMigrations(local: string[], rows: MigrationRow[]): string[] {
  const done = new Set(rows.filter((r) => r.finished && !r.rolledBack).map((r) => r.name));
  return local.filter((name) => !done.has(name));
}

/**
 * "fresh": empty database — `migrate deploy` creates everything.
 * "migrated": 0_init is recorded — `migrate deploy` applies what is pending.
 * "legacy-db-push": v3 tables exist but 0_init is not recorded — baseline first.
 * Throws when the schema can't be identified safely.
 */
export async function detectDatabaseState(prisma: PrismaClient): Promise<"fresh" | "migrated" | "legacy-db-push"> {
  const rows = await migrationRows(prisma);
  if (baselineRecorded(rows)) return "migrated";
  if (!(await tableExists(prisma, "User"))) return "fresh";
  const missing: string[] = [];
  for (const t of V3_TABLES) if (!(await tableExists(prisma, t))) missing.push(t);
  if (missing.length) {
    throw new Error(
      `This database was created by an older \`prisma db push\` and is missing v3 tables (${missing.join(", ")}). ` +
        "Deploy the v3 release once (which syncs the schema) before this one, or restore from a backup."
    );
  }
  if (await tableExists(prisma, V4_MARKER)) {
    throw new Error(
      `This database already has v4 tables ("${V4_MARKER}") but no record of migration ${BASELINE} — it was probably synced with \`prisma db push\` from v4 code. ` +
        `Refusing to guess. If its schema matches prisma/schema.prisma exactly (check with \`prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma\`), ` +
        "mark every migration applied with `prisma migrate resolve --applied <name>`; otherwise restore from a backup."
    );
  }
  return "legacy-db-push";
}

/** Migrations recorded as failed (not finished, not rolled back) that this release ships. */
async function failedMigrations(prisma: PrismaClient): Promise<string[]> {
  const local = new Set(localMigrationNames());
  const rows = await migrationRows(prisma);
  const done = new Set(rows.filter((r) => r.finished && !r.rolledBack).map((r) => r.name));
  return [...new Set(rows.filter((r) => !r.finished && !r.rolledBack && !done.has(r.name) && local.has(r.name)).map((r) => r.name))];
}

/** Marks failed migrations rolled back. Safe because Postgres applied each one in a transaction that was rolled back. */
async function clearFailed(prisma: PrismaClient, url: string): Promise<string[]> {
  const failed = await failedMigrations(prisma);
  for (const name of failed) {
    console.log(`[migrate] ${name} is recorded as failed; it ran in a transaction, so nothing was applied — marking it rolled back`);
    await prismaCliOrThrow(["migrate", "resolve", "--rolled-back", name], url);
  }
  return failed;
}

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

async function main() {
  const target = resolveMigrationTarget();
  console.log(`[migrate] connecting with ${target.source}`);
  if (target.pooled) {
    console.warn(
      `[migrate] WARNING: ${target.source} is a connection POOLER (Neon "-pooler" host or pgbouncer=true). Prisma's migration lock does not work reliably through a pooler, ` +
        "so migrations can fail with P1002. Set DIRECT_URL to the direct (non-pooled) connection string; the app can keep using DATABASE_URL."
    );
  }
  const prisma = new PrismaClient({ datasourceUrl: target.url });
  try {
    await clearFailed(prisma, target.url); // e.g. a 0_init attempt on a legacy database, or a deploy cut off mid-way
    const state = await detectDatabaseState(prisma);
    console.log(`[migrate] database state: ${state}`);
    if (state === "legacy-db-push") {
      console.log(`[migrate] baselining: recording ${BASELINE} as already applied (no schema change)`);
      const r = await prismaCli(["migrate", "resolve", "--applied", BASELINE], target.url);
      // Another process may have baselined at the same moment.
      if (!r.ok) {
        if (!baselineRecorded(await migrationRows(prisma))) throw new Error(`prisma migrate resolve --applied ${BASELINE} failed`);
        console.log(`[migrate] ${BASELINE} was recorded by another process meanwhile — continuing`);
      }
    }
    await applyPendingMigrations(
      {
        pending: async () => pendingMigrations(localMigrationNames(), await migrationRows(prisma)),
        deploy: () => prismaCli(["migrate", "deploy"], target.url),
        clearFailed: () => clearFailed(prisma, target.url),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        log: (m) => console.log(`[migrate] ${m}`),
      },
      { maxAttempts: intFromEnv("MIGRATE_MAX_ATTEMPTS", 5, 1, 10), retryDelayMs: intFromEnv("MIGRATE_RETRY_DELAY_MS", 10_000, 0, 60_000) }
    );
  } finally {
    await prisma.$disconnect();
  }
  console.log("[migrate] done");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[migrate] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
