// The boot-time migrator (src/ops/migrate.ts) against every database state it
// can meet in production. Each case uses its own throwaway database; a v3
// "db push" database is reproduced by applying 0_init's SQL (= the v3 schema).

import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const base = new URL(process.env.TEST_DATABASE_URL || "postgresql://ensemblis:ensemblis@localhost:5432/ensemblis_test?schema=public");
const root = path.resolve(__dirname, "../..");
const prismaCli = require.resolve("prisma/build/index.js");
const tsx = require.resolve("tsx/cli");

function urlFor(db: string) {
  const u = new URL(base.toString());
  u.pathname = `/${db}`;
  return u.toString();
}

async function freshDb(case_: string): Promise<string> {
  // Named after the run's test database (ensemblis_test → ensemblis_test_m_legacy), so runs against
  // different TEST_DATABASE_URLs never drop each other's throwaway databases.
  const name = case_.replace(/^ensemblis_test/, decodeURIComponent(base.pathname.slice(1)) || "ensemblis_test");
  const admin = new PrismaClient({ datasources: { db: { url: urlFor("postgres") } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await admin.$disconnect();
  return urlFor(name);
}

function sql(url: string, statements: string) {
  execFileSync(process.execPath, [prismaCli, "db", "execute", "--stdin", "--url", url], { input: statements, cwd: root, stdio: ["pipe", "pipe", "pipe"] });
}

const V3_SCHEMA = path.join(root, "prisma/migrations/0_init/migration.sql");
function v3Database(url: string) {
  execFileSync(process.execPath, [prismaCli, "db", "execute", "--file", V3_SCHEMA, "--url", url], { cwd: root, stdio: "pipe" });
  sql(url, `INSERT INTO "User"(id,email,"passwordHash",name,credits) VALUES ('u1','legacy@example.com','hash','Legacy',4321);
            INSERT INTO "Task"(id,"userId",title,description,status,"shareToken") VALUES ('t1','u1','Old report','d','COMPLETED','tok_legacy_0123456789');`);
}

function migrate(url: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [tsx, "src/ops/migrate.ts"], { cwd: root, env: { ...process.env, DATABASE_URL: url } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("exit", (code) => resolve({ code: code ?? 1, out }));
  });
}

function noDrift(url: string) {
  // exit code 0 = schema identical to prisma/schema.prisma (throws otherwise)
  execFileSync(process.execPath, [prismaCli, "migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"], { cwd: root, stdio: "pipe" });
}

async function legacyDataIntact(url: string) {
  const p = new PrismaClient({ datasources: { db: { url } } });
  const u = await p.user.findUnique({ where: { id: "u1" } });
  const t = await p.task.findUnique({ where: { id: "t1" } });
  await p.$disconnect();
  expect(u).toMatchObject({ email: "legacy@example.com", passwordHash: "hash", credits: 4321 });
  expect(t).toMatchObject({ shareToken: "tok_legacy_0123456789" });
}

describe("boot migrator", { timeout: 120_000 }, () => {
  it("fresh database: creates the full schema", async () => {
    const url = await freshDb("ensemblis_test_m_fresh");
    const r = await migrate(url);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/database state: fresh/);
    noDrift(url);
  });

  it("v3 db-push database: baselines, applies the additive migration, keeps every row, no drift; second boot is a no-op", async () => {
    const url = await freshDb("ensemblis_test_m_legacy");
    v3Database(url);
    const r = await migrate(url);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/database state: legacy-db-push/);
    await legacyDataIntact(url);
    noDrift(url);
    const again = await migrate(url);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toMatch(/database state: migrated/);
  });

  it("v3 database with a local `prisma migrate dev` history (no 0_init recorded) is baselined, not re-created", async () => {
    const url = await freshDb("ensemblis_test_m_mdev");
    v3Database(url);
    sql(url, `CREATE TABLE "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0);
              INSERT INTO "_prisma_migrations" VALUES ('11111111-1111-1111-1111-111111111111','abc', now(), '20250101000000_v3', NULL, NULL, now(), 1);`);
    const r = await migrate(url);
    expect(r.code, r.out).toBe(0);
    await legacyDataIntact(url);
    noDrift(url);
  });

  it("recovers a migration recorded as failed (crash or lost connection mid-deploy) instead of blocking every boot", async () => {
    // Prisma applies each migration in a transaction, so a failed record means the schema is still v3.
    const url = await freshDb("ensemblis_test_m_failed");
    v3Database(url);
    sql(url, `CREATE TABLE "_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0);
              INSERT INTO "_prisma_migrations" VALUES ('22222222-2222-2222-2222-222222222222','x', now(), '0_init', NULL, NULL, now(), 0);
              INSERT INTO "_prisma_migrations" VALUES ('33333333-3333-3333-3333-333333333333','y', NULL, '20261007120000_outcome_execution_system', 'connection lost', NULL, now(), 0);`);
    const r = await migrate(url);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/recorded as failed/);
    await legacyDataIntact(url);
    noDrift(url);
  });

  it("two processes booting at once on a v3 database both succeed", async () => {
    const url = await freshDb("ensemblis_test_m_race");
    v3Database(url);
    const [a, b] = await Promise.all([migrate(url), migrate(url)]);
    expect(a.code, a.out).toBe(0);
    expect(b.code, b.out).toBe(0);
    await legacyDataIntact(url);
    noDrift(url);
  });

  it("carries outcomes a person confirmed before confirmedOutcomeStatus existed over to it (data only, no drift)", async () => {
    // A database deployed up to 20261014120000_real_execution_v1, holding a confirmation made by the code before it.
    const url = await freshDb("ensemblis_test_m_backfill");
    for (const name of ["0_init", "20261007120000_outcome_execution_system", "20261008090000_planning_quota_indexes", "20261014120000_real_execution_v1"]) {
      execFileSync(process.execPath, [prismaCli, "db", "execute", "--file", path.join(root, "prisma/migrations", name, "migration.sql"), "--url", url], { cwd: root, stdio: "pipe" });
      execFileSync(process.execPath, [prismaCli, "migrate", "resolve", "--applied", name], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    }
    sql(url, `INSERT INTO "User"(id,email,"passwordHash",name,credits) VALUES ('u1','legacy@example.com','hash','Legacy',4321);
              INSERT INTO "Organization"(id,name,"ownerId","updatedAt") VALUES ('o1','Legacy','u1',now());
              INSERT INTO "Objective"(id,"orgId",title,statement,"budgetCents","updatedAt") VALUES ('ob1','o1','Brief','Research it',2000,now());
              INSERT INTO "Execution"(id,"objectiveId","orgId",status,"outcomeStatus","outcomeConfirmedAt","confirmedOutcomeStatus","updatedAt") VALUES
                ('e1_legacy_confirmed','ob1','o1','COMPLETED','ACHIEVED',now(),NULL,now()),
                ('e2_ai_assessed','ob1','o1','COMPLETED','PARTIALLY_ACHIEVED',NULL,NULL,now()),
                ('e3_confirmed_since','ob1','o1','COMPLETED','ACHIEVED',now(),'NOT_ACHIEVED',now());`);
    const r = await migrate(url);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/database state: migrated/);
    noDrift(url);
    const p = new PrismaClient({ datasources: { db: { url } } });
    const rows = await p.execution.findMany({ select: { id: true, outcomeStatus: true, confirmedOutcomeStatus: true }, orderBy: { id: "asc" } });
    await p.$disconnect();
    expect(rows).toEqual([
      { id: "e1_legacy_confirmed", outcomeStatus: "ACHIEVED", confirmedOutcomeStatus: "ACHIEVED" },
      { id: "e2_ai_assessed", outcomeStatus: "PARTIALLY_ACHIEVED", confirmedOutcomeStatus: null },
      { id: "e3_confirmed_since", outcomeStatus: "ACHIEVED", confirmedOutcomeStatus: "NOT_ACHIEVED" },
    ]);
  });

  it("refuses to guess when v4 tables exist without any migration history", async () => {
    const url = await freshDb("ensemblis_test_m_pushed_v4");
    execFileSync(process.execPath, [prismaCli, "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    const r = await migrate(url);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/already has v4 tables/);
  });
});
