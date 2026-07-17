import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/stats — overview stats for the admin panel. */
export async function GET() {
  try {
    await requireAdmin();
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 403 });
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    freeUsers,
    premiumUsers,
    adminUsers,
    translationsToday,
    translationsLast7,
    recentJobs,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { role: "FREE" } }),
    db.user.count({ where: { role: "PREMIUM" } }),
    db.user.count({ where: { role: "ADMIN" } }),
    db.translationJob.count({
      where: { createdAt: { gte: new Date(today + "T00:00:00.000Z") } },
    }),
    db.translationJob.count({ where: { createdAt: { gte: last7Start } } }),
    db.translationJob.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { email: true, name: true },
        },
      },
    }),
  ]);

  // Daily breakdown for last 7 days
  const dailyBreakdown: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    const count = await db.translationJob.count({
      where: {
        createdAt: {
          gte: new Date(dateStr + "T00:00:00.000Z"),
          lt: new Date(dateStr + "T23:59:59.999Z"),
        },
      },
    });
    dailyBreakdown.push({ date: dateStr, count });
  }

  return NextResponse.json({
    users: { total: totalUsers, free: freeUsers, premium: premiumUsers, admin: adminUsers },
    translations: { today: translationsToday, last7Days: translationsLast7 },
    dailyBreakdown,
    recentJobs: recentJobs.map((j) => ({
      id: j.id,
      title: j.title,
      cueCount: j.cueCount,
      translatedCount: j.translatedCount,
      source: j.source,
      format: j.format,
      durationMs: j.durationMs,
      createdAt: j.createdAt,
      userEmail: j.user.email,
      userName: j.user.name,
    })),
  });
}
