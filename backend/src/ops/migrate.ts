// Production schema deployment — `npm run migrate:deploy` (node dist/ops/migrate.js).
// Runs before the API starts. It replaces the old `prisma db push` boot step.
//
//   1. Baseline: databases created by the old boot (`prisma db push`) have the
//      v3 tables but no `_prisma_migrations` history. For those, migration
//      0_init — generated from exactly that v3 schema — is recorded as already
//      applied (`prisma migrate resolve --applied 0_init`). Nothing is changed.
//   2. `prisma migrate deploy` applies every pending migration in order. All
//      migrations after 0_init are additive (new tables, nullable/defaulted
//      columns), so existing rows are kept.
//
// Safe to run repeatedly and from several processes at once (Prisma takes an
// advisory lock during `migrate deploy`). Never uses --accept-data-loss.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const BASELINE = "0_init";
/** Tables the v3 schema (= 0_init) created. A db-push database missing any of them predates v3. */
const V3_TABLES = ["User", "Task", "Transaction", "TaskSource", "TaskRevision", "StripePayment", "UsageEvent", "GalleryItem", "Team"];

const schemaPath = path.resolve(__dirname, "../../prisma/schema.prisma");

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

/** Returns "fresh" | "migrated" | "legacy-db-push". Throws when a legacy database is too old to baseline. */
export async function detectDatabaseState(prisma: PrismaClient): Promise<"fresh" | "migrated" | "legacy-db-push"> {
  if (await tableExists(prisma, "_prisma_migrations")) return "migrated";
  if (!(await tableExists(prisma, "User"))) return "fresh";
  const missing: string[] = [];
  for (const t of V3_TABLES) if (!(await tableExists(prisma, t))) missing.push(t);
  if (missing.length) {
    throw new Error(
      `This database was created by an older \`prisma db push\` and is missing v3 tables (${missing.join(", ")}). ` +
        "Deploy the v3 release once (which syncs the schema) before this one, or restore from a backup."
    );
  }
  return "legacy-db-push";
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient();
  let state: Awaited<ReturnType<typeof detectDatabaseState>>;
  try {
    state = await detectDatabaseState(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log(`[migrate] database state: ${state}`);
  if (state === "legacy-db-push") {
    console.log(`[migrate] baselining: recording ${BASELINE} as already applied (no schema change)`);
    prismaCli(["migrate", "resolve", "--applied", BASELINE]);
  }
  prismaCli(["migrate", "deploy"]);
  console.log("[migrate] done");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[migrate] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
