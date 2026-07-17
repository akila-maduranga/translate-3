/**
 * Usage limiter — enforces the free-tier "1 subtitle per day" rule.
 *
 * Rules:
 *   FREE     → 1 translation per UTC day
 *   PREMIUM  → unlimited
 *   ADMIN    → unlimited
 *
 * A "translation" = one .srt/.vtt file fully translated end-to-end.
 * We count on completion (not on start) so failed translations don't
 * burn the user's daily quota.
 */

import { db } from "@/lib/db";
import type { Role } from "@/lib/auth";

export const FREE_DAILY_LIMIT = 1;

/** Returns YYYY-MM-DD for the given UTC date. */
function utcDateString(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface UsageStatus {
  role: Role;
  limit: number;       // 0 means unlimited
  usedToday: number;
  remaining: number;   // 0 means unlimited OR no remaining
  unlimited: boolean;
}

/**
 * Get the current user's usage status for today.
 */
export async function getUsageStatus(userId: string, role: Role): Promise<UsageStatus> {
  if (role === "PREMIUM" || role === "ADMIN") {
    return {
      role,
      limit: 0,
      usedToday: 0,
      remaining: 0,
      unlimited: true,
    };
  }
  const date = utcDateString();
  const row = await db.dailyUsage.findUnique({
    where: { userId_date: { userId, date } },
  });
  const usedToday = row?.count ?? 0;
  return {
    role,
    limit: FREE_DAILY_LIMIT,
    usedToday,
    remaining: Math.max(0, FREE_DAILY_LIMIT - usedToday),
    unlimited: false,
  };
}

/**
 * Check if the user can start a new translation. Doesn't increment —
 * call `recordTranslation` after the job completes.
 *
 * Throws UsageLimitError if the user is over quota.
 */
export async function checkCanTranslate(userId: string, role: Role): Promise<void> {
  if (role === "PREMIUM" || role === "ADMIN") return;
  const status = await getUsageStatus(userId, role);
  if (status.remaining <= 0) {
    throw new UsageLimitError(
      `You've used your daily free translation. Come back tomorrow (UTC midnight) or upgrade to premium for unlimited translations.`,
      status
    );
  }
}

/**
 * Record a completed translation job. Increments the daily usage
 * counter and creates a TranslationJob row for history/stats.
 */
export async function recordTranslation(params: {
  userId: string;
  role: Role;
  title: string;
  cueCount: number;
  translatedCount: number;
  source: "tmdb" | "ai";
  format: "srt" | "vtt";
  durationMs: number;
}): Promise<void> {
  const date = utcDateString();
  // Upsert the daily usage row.
  await db.dailyUsage.upsert({
    where: {
      userId_date: { userId: params.userId, date },
    },
    create: {
      userId: params.userId,
      date,
      count: 1,
    },
    update: {
      count: { increment: 1 },
    },
  });
  // Record the job.
  await db.translationJob.create({
    data: {
      userId: params.userId,
      title: params.title,
      cueCount: params.cueCount,
      translatedCount: params.translatedCount,
      source: params.source,
      format: params.format,
      durationMs: params.durationMs,
    },
  });
}

export class UsageLimitError extends Error {
  status: UsageStatus;
  constructor(message: string, status: UsageStatus) {
    super(message);
    this.name = "UsageLimitError";
    this.status = status;
  }
}
