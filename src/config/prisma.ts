import { PrismaClient } from "@prisma/client";

// Single shared Prisma instance across the app (avoids exhausting
// SQLite/Postgres connections during dev hot-reload).
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
