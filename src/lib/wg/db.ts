import { PrismaClient } from "@/generated/wg-prisma";

const globalForWgPrisma = globalThis as unknown as { wgPrisma?: PrismaClient };

export const db =
  globalForWgPrisma.wgPrisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForWgPrisma.wgPrisma = db;
