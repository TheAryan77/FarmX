import { PrismaClient } from "@prisma/client";

import { env } from "../env.js";

/**
 * Single Prisma client for the process. `tsx watch` re-executes this module on
 * every save, so the instance is stashed on globalThis to avoid leaking a
 * connection pool per reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
