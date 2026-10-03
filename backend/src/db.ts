import { PrismaClient } from "@prisma/client";

// A single shared Prisma client for the whole process.
export const prisma = new PrismaClient();
