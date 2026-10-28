// The boot migrator's decision logic (src/ops/migrate.ts) without a database or the Prisma CLI:
// when it takes Prisma's migration lock at all, what it retries, and when it gives up.

import { describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  classifyFailure,
  MigrationFailedError,
  pendingMigrations,
  resolveMigrationTarget,
  type CliResult,
  type DeployDeps,
} from "../../src/ops/migrate";

// What Prisma 5.22 prints when its advisory lock is busy (captured from a real run).
const P1002 = `Error: P1002

The database server at \`ep-example-pooler.c-5.eu-central-1.aws.neon.tech:5432\` was reached but timed out.

Please try again.

Please make sure your database server is running at \`ep-example-pooler.c-5.eu-central-1.aws.neon.tech:5432\`.

Context: Timed out trying to acquire a postgres advisory lock (SELECT pg_advisory_lock(72707369)). Elapsed: 10000ms. See https://pris.ly/d/migrate-advisory-locking for details.`;
const P1001 = "Error: P1001: Can't reach database server at `db.example.com:5432`";
const P1017 = "Error: P1017: Server has closed the connection.";
const P3018 = 'Error: P3018\n\nA migration failed to apply. New migrations cannot be applied before the error is recovered from.\n\nDatabase error: ERROR: relation "x" already exists';

const ok: CliResult = { ok: true, output: "All migrations have been successfully applied." };
const fail = (output: string): CliResult => ({ ok: false, output });

/** Fake dependencies: `pendingSeq` is returned call by call (the last value repeats), `deploys` result by result. */
function fakes(opts: { pendingSeq: string[][]; deploys?: CliResult[]; cleared?: string[][] }) {
  const calls = { pending: 0, deploy: 0, clearFailed: 0, sleeps: [] as number[], logs: [] as string[] };
  const deps: DeployDeps = {
    pending: async () => opts.pendingSeq[Math.min(calls.pending++, opts.pendingSeq.length - 1)],
    deploy: async () => {
      const r = opts.deploys?.[calls.deploy];
      calls.deploy++;
      if (!r) throw new Error("unexpected extra deploy");
      return r;
    },
    clearFailed: async () => (opts.cleared ?? [])[calls.clearFailed++] ?? [],
    sleep: async (ms) => {
      calls.sleeps.push(ms);
    },
    log: (m) => calls.logs.push(m),
  };
  return { deps, calls };
}

const two = ["20261023120000_credit_ledger", "20261023120100_ledger_opening_balances"];

describe("classifyFailure", () => {
  it("recognises Prisma's lock timeout even though its text also says the server is not running", () => {
    expect(classifyFailure(P1002)).toBe("lock-timeout");
  });
  it("treats an unreachable or dropped connection as transient", () => {
    expect(classifyFailure(P1001)).toBe("connection");
    expect(classifyFailure(P1017)).toBe("connection");
  });
  it("treats a migration's own error, history problems and empty output as non-transient", () => {
    expect(classifyFailure(P3018)).toBe("migration");
    expect(classifyFailure("Error: P3009\n\nmigrate found failed migrations in the target database")).toBe("migration");
    expect(classifyFailure("")).toBe("migration");
  });
});

describe("resolveMigrationTarget", () => {
  it("uses DATABASE_URL by default", () => {
    const t = resolveMigrationTarget({ DATABASE_URL: "postgresql://u:p@db.example.com/app" });
    expect(t).toMatchObject({ source: "DATABASE_URL", url: "postgresql://u:p@db.example.com/app", pooled: false });
  });
  it("prefers DIRECT_URL for migrations and ignores a blank one", () => {
    const env = { DATABASE_URL: "postgresql://u:p@ep-x-pooler.c-5.eu-central-1.aws.neon.tech/app", DIRECT_URL: "  postgresql://u:p@ep-x.c-5.eu-central-1.aws.neon.tech/app  " };
    expect(resolveMigrationTarget(env)).toMatchObject({ source: "DIRECT_URL", url: "postgresql://u:p@ep-x.c-5.eu-central-1.aws.neon.tech/app", pooled: false });
    expect(resolveMigrationTarget({ ...env, DIRECT_URL: "   " }).source).toBe("DATABASE_URL");
  });
  it("flags a pooled connection (Neon -pooler host or pgbouncer=true)", () => {
    expect(resolveMigrationTarget({ DATABASE_URL: "postgresql://u:p@ep-x-pooler.c-5.eu-central-1.aws.neon.tech/app?sslmode=require" }).pooled).toBe(true);
    expect(resolveMigrationTarget({ DATABASE_URL: "postgresql://u:p@db.example.com:6432/app?pgbouncer=true" }).pooled).toBe(true);
    expect(resolveMigrationTarget({ DATABASE_URL: "postgresql://u:p@ep-x.c-5.eu-central-1.aws.neon.tech/app?sslmode=require" }).pooled).toBe(false);
  });
  it("accepts the direct string of the same Neon endpoint and database, pooled or not", () => {
    const env = { DATABASE_URL: "postgresql://u:p@ep-wild-x-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require", DIRECT_URL: "postgresql://u:p@ep-wild-x.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require" };
    expect(resolveMigrationTarget(env)).toMatchObject({ source: "DIRECT_URL", pooled: false });
    expect(resolveMigrationTarget({ ...env, DIRECT_URL: env.DATABASE_URL }).pooled).toBe(true); // identical strings are fine too
  });
  it("refuses a DIRECT_URL for another endpoint (e.g. a backup branch) or another database — migrations would hit the wrong one", () => {
    const app = "postgresql://u:p@ep-wild-x-pooler.c-5.eu-central-1.aws.neon.tech/neondb";
    expect(() => resolveMigrationTarget({ DATABASE_URL: app, DIRECT_URL: "postgresql://u:p@ep-backup-y.c-5.eu-central-1.aws.neon.tech/neondb" })).toThrow(/differ in the host.*backup branch/s);
    expect(() => resolveMigrationTarget({ DATABASE_URL: app, DIRECT_URL: "postgresql://u:p@ep-wild-x.c-5.eu-central-1.aws.neon.tech/otherdb" })).toThrow(/differ in the database name/);
    expect(() => resolveMigrationTarget({ DATABASE_URL: app, DIRECT_URL: "postgresql://u:p@ep-other.example.com/otherdb" })).toThrow(/host and database name/);
    // an intended difference needs an explicit opt-in
    expect(resolveMigrationTarget({ DATABASE_URL: app, DIRECT_URL: "postgresql://u:p@ep-backup-y.example.com/neondb", MIGRATE_ALLOW_DIFFERENT_TARGET: "1" }).source).toBe("DIRECT_URL");
    // nothing to compare against
    expect(resolveMigrationTarget({ DIRECT_URL: "postgresql://u:p@ep-backup-y.example.com/neondb" }).source).toBe("DIRECT_URL");
  });
  it("fails clearly without leaking the connection string", () => {
    expect(() => resolveMigrationTarget({})).toThrow(/DATABASE_URL is not set/);
    expect(() => resolveMigrationTarget({ DIRECT_URL: "this is not a url, pw=hunter2-secret" })).toThrow(/DIRECT_URL is not a valid/);
    try {
      resolveMigrationTarget({ DATABASE_URL: "mysql://user:hunter2-secret@db.example.com/app" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(String(err)).toMatch(/DATABASE_URL must start with postgresql/);
      expect(String(err)).not.toMatch(/hunter2/);
    }
    try {
      resolveMigrationTarget({ DIRECT_URL: "not a url pw=hunter2-secret" });
    } catch (err) {
      expect(String(err)).not.toMatch(/hunter2/);
    }
  });
});

describe("pendingMigrations", () => {
  const row = (name: string, finished = true, rolledBack = false) => ({ name, finished, rolledBack });
  it("is empty when every shipped migration is recorded as finished", () => {
    expect(pendingMigrations(["0_init", ...two], [row("0_init"), ...two.map((n) => row(n))])).toEqual([]);
  });
  it("lists migrations with no record, an unfinished record, or a rolled-back record", () => {
    expect(pendingMigrations(["0_init", ...two], [row("0_init")])).toEqual(two);
    expect(pendingMigrations(["0_init", "m1"], [row("0_init"), row("m1", false)])).toEqual(["m1"]);
    expect(pendingMigrations(["0_init", "m1"], [row("0_init"), row("m1", false, true)])).toEqual(["m1"]);
    expect(pendingMigrations(["0_init", "m1"], [row("0_init"), row("m1", true, true)])).toEqual(["m1"]);
  });
  it("counts a migration applied when a later attempt finished after an earlier rolled-back one", () => {
    expect(pendingMigrations(["0_init", "m1"], [row("0_init"), row("m1", false, true), row("m1")])).toEqual([]);
  });
  it("ignores recorded migrations this release does not ship (a newer release ran before a rollback)", () => {
    expect(pendingMigrations(["0_init"], [row("0_init"), row("20270101000000_from_the_future")])).toEqual([]);
  });
});

describe("applyPendingMigrations", () => {
  const opts = { maxAttempts: 3, retryDelayMs: 1000 };

  it("never runs `prisma migrate deploy` (so never takes its lock) when nothing is pending", async () => {
    const { deps, calls } = fakes({ pendingSeq: [[]] });
    await expect(applyPendingMigrations(deps, opts)).resolves.toEqual({ attempts: 0, applied: [] });
    expect(calls).toMatchObject({ deploy: 0, clearFailed: 0, sleeps: [] });
    expect(calls.logs.join("\n")).toMatch(/no pending migrations/);
  });

  it("applies pending migrations in one deploy", async () => {
    const { deps, calls } = fakes({ pendingSeq: [two], deploys: [ok] });
    await expect(applyPendingMigrations(deps, opts)).resolves.toEqual({ attempts: 1, applied: two });
    expect(calls.deploy).toBe(1);
    expect(calls.sleeps).toEqual([]);
  });

  it("retries a lock timeout after a pause and succeeds when the lock frees up", async () => {
    const { deps, calls } = fakes({ pendingSeq: [two, two], deploys: [fail(P1002), ok] });
    await expect(applyPendingMigrations(deps, opts)).resolves.toMatchObject({ attempts: 2, applied: two });
    expect(calls.deploy).toBe(2);
    expect(calls.sleeps).toEqual([1000]);
    expect(calls.pending).toBe(2); // the pending list is re-read before every try
  });

  it("retries a lost connection too", async () => {
    const { deps, calls } = fakes({ pendingSeq: [two], deploys: [fail(P1017), fail(P1001), ok] });
    await expect(applyPendingMigrations(deps, opts)).resolves.toMatchObject({ attempts: 3 });
    expect(calls.sleeps).toEqual([1000, 2000]); // linear back-off
  });

  it("gives up after maxAttempts with a clear, actionable error (a persistent lock problem is not hidden)", async () => {
    const { deps, calls } = fakes({ pendingSeq: [two], deploys: [fail(P1002), fail(P1002), fail(P1002)] });
    const err = await applyPendingMigrations(deps, opts).catch((e) => e);
    expect(err).toBeInstanceOf(MigrationFailedError);
    expect(err).toMatchObject({ kind: "lock-timeout", attempts: 3 });
    expect(err.message).toMatch(/after 3 attempts/);
    expect(err.message).toMatch(/DIRECT_URL/);
    expect(err.message).toMatch(/API was not started/);
    expect(calls.deploy).toBe(3);
    expect(calls.sleeps).toEqual([1000, 2000]); // no pause after the last attempt
  });

  it("does not retry at all when maxAttempts is 1", async () => {
    const { deps, calls } = fakes({ pendingSeq: [two], deploys: [fail(P1002)] });
    await expect(applyPendingMigrations(deps, { maxAttempts: 1, retryDelayMs: 1000 })).rejects.toMatchObject({ kind: "lock-timeout", attempts: 1 });
    expect(calls.sleeps).toEqual([]);
  });

  it("ends without a second deploy when another process applied the work while this one waited for the lock", async () => {
    const { deps, calls } = fakes({ pendingSeq: [two, []], deploys: [fail(P1002)] });
    await expect(applyPendingMigrations(deps, opts)).resolves.toEqual({ attempts: 1, applied: [] });
    expect(calls.deploy).toBe(1);
    expect(calls.logs.join("\n")).toMatch(/another process applied them/);
  });

  it("does not retry a migration's own error: one deploy, no pause, no duplicate application", async () => {
    const { deps, calls } = fakes({ pendingSeq: [two], deploys: [fail(P3018)] });
    const err = await applyPendingMigrations(deps, opts).catch((e) => e);
    expect(err).toMatchObject({ kind: "migration", attempts: 1 });
    expect(err.message).toMatch(/not a lock or connection error/);
    expect(calls).toMatchObject({ deploy: 1, sleeps: [] });
  });

  it("clears a failed-migration record and retries once, immediately", async () => {
    const { deps, calls } = fakes({ pendingSeq: [two], deploys: [fail(P3018), ok], cleared: [["20261023120000_credit_ledger"]] });
    await expect(applyPendingMigrations(deps, opts)).resolves.toMatchObject({ attempts: 2 });
    expect(calls.sleeps).toEqual([]);
    expect(calls.logs).toContain("retrying once");
  });

  it("after that one retry, a genuine failure stops the boot and leaves the failed record for inspection", async () => {
    const { deps, calls } = fakes({ pendingSeq: [two], deploys: [fail(P3018), fail(P3018)], cleared: [["20261023120000_credit_ledger"]] });
    await expect(applyPendingMigrations(deps, opts)).rejects.toMatchObject({ kind: "migration", attempts: 2 });
    expect(calls.deploy).toBe(2);
    expect(calls.clearFailed).toBe(1);
  });
});
