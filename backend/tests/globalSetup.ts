import { execFileSync } from "node:child_process";
import path from "node:path";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL || "postgresql://ensemblis:ensemblis@localhost:5432/ensemblis_test?schema=public";
  const cli = require.resolve("prisma/build/index.js");
  // Drop everything and apply all migrations from 0_init: the migrations are under test too.
  execFileSync(process.execPath, [cli, "migrate", "reset", "--force", "--skip-seed", "--skip-generate", "--schema", path.resolve(__dirname, "../prisma/schema.prisma")], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
