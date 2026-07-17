import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Always create a fresh client when this module is reloaded by the dev
// server — the cached instance can hold a stale schema after `db:push`.
// In production this code path runs once per cold start.
if (globalForPrisma.prisma) {
  try { globalForPrisma.prisma.$disconnect() } catch {}
  globalForPrisma.prisma = undefined
}

export const db = new PrismaClient({
  log: ['query'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db