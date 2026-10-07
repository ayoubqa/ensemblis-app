// Operator tool: mark an account's email as verified when email delivery
// isn't configured (e.g. to unlock the owner dashboard for an ADMIN_EMAILS
// address). Requires direct database access — run it locally against the
// production DATABASE_URL:  npm run ops:verify-email -- you@example.com

import { prisma } from "../db";

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) throw new Error("Usage: npm run ops:verify-email -- <email>");
  const u = await prisma.user.updateMany({ where: { email, isGuest: false }, data: { emailVerifiedAt: new Date() } });
  console.log(u.count ? `Verified ${email}.` : `No registered account with email ${email}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
