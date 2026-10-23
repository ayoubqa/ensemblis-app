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
//   3. `prisma migrate deploy` applies every pending migration in order. All
//      migrations after 0_init are additive (new tables, nullable/defaulted
//      columns), so existing rows are kept.
//
// Safe to run repeatedly and from several processes at once (Prisma takes an
// advisory lock during `migrate deploy`; a lost baseline race is detected and
// ignored). Never uses --accept-data-loss and never runs `db push`.

import { execFileSync } from "node:child_process";
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

function prismaCli(args: string[]) {
  const cli = require.resolve("prisma/build/index.js");
  execFileSync(process.execPath, [cli, ...args, "--schema", schemaPath], { stdio: "inherit", env: process.env });
}

async function tableExists(prisma: PrismaClient, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT to_regclass('public."${table.replace(/"/g, "")}"') IS NOT NULL AS "exists"`
  );
  return !!rows[0]?.exists;
}

async function migrationRows(prisma: PrismaClient): Promise<{ name: string; finished: boolean; rolledBack: boolean }[]> {
  if (!(await tableExists(prisma, "_prisma_migrations"))) return [];
  const rows = await prisma.$queryRawUnsafe<{ migration_name: string; finished: boolean; rolled_back: boolean }[]>(
    `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations"`
  );
  return rows.map((r) => ({ name: r.migration_name, finished: r.finished, rolledBack: r.rolled_back }));
}

const baselineRecorded = (rows: { name: string; finished: boolean; rolledBack: boolean }[]) => rows.some((r) => r.name === BASELINE && r.finished && !r.rolledBack);

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
  const local = new Set(fs.readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
  const rows = await migrationRows(prisma);
  const done = new Set(rows.filter((r) => r.finished && !r.rolledBack).map((r) => r.name));
  return [...new Set(rows.filter((r) => !r.finished && !r.rolledBack && !done.has(r.name) && local.has(r.name)).map((r) => r.name))];
}

/** Marks failed migrations rolled back. Safe because Postgres applied each one in a transaction that was rolled back. */
async function clearFailed(prisma: PrismaClient): Promise<string[]> {
  const failed = await failedMigrations(prisma);
  for (const name of failed) {
    console.log(`[migrate] ${name} is recorded as failed; it ran in a transaction, so nothing was applied — marking it rolled back`);
    prismaCli(["migrate", "resolve", "--rolled-back", name]);
  }
  return failed;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient();
  try {
    await clearFailed(prisma); // e.g. a 0_init attempt on a legacy database, or a deploy cut off mid-way
    const state = await detectDatabaseState(prisma);
    console.log(`[migrate] database state: ${state}`);
    if (state === "legacy-db-push") {
      console.log(`[migrate] baselining: recording ${BASELINE} as already applied (no schema change)`);
      try {
        prismaCli(["migrate", "resolve", "--applied", BASELINE]);
      } catch (err) {
        // Another process may have baselined at the same moment.
        if (!baselineRecorded(await migrationRows(prisma))) throw err;
        console.log(`[migrate] ${BASELINE} was recorded by another process meanwhile — continuing`);
      }
    }
    try {
      prismaCli(["migrate", "deploy"]);
    } catch (err) {
      // A transient failure (connection lost, lock timeout) leaves a failed record that would block every boot.
      const cleared = await clearFailed(prisma);
      if (!cleared.length) throw err;
      console.log("[migrate] retrying once");
      prismaCli(["migrate", "deploy"]);
    }
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
