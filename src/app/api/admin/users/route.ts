import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users
 *
 * Returns all users (without password hashes) with their recent
 * translation counts. Admin-only.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 403 });
  }

  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      _count: { select: { translations: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Compute today's usage for each user.
  const today = new Date().toISOString().slice(0, 10);
  const usages = await db.dailyUsage.findMany({
    where: { date: today },
    select: { userId: true, count: true },
  });
  const usageMap = new Map(usages.map((u) => [u.userId, u.count]));

  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      translationsToday: usageMap.get(u.id) ?? 0,
    })),
  });
}

/**
 * PATCH /api/admin/users
 * Body: { userId, role }
 *
 * Updates a user's role. Admin-only.
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status || 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    role?: "FREE" | "PREMIUM" | "ADMIN";
  };

  if (!body.userId || !body.role) {
    return NextResponse.json(
      { error: "userId and role are required." },
      { status: 400 }
    );
  }
  if (!["FREE", "PREMIUM", "ADMIN"].includes(body.role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: body.userId },
    data: { role: body.role },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return NextResponse.json({ user: updated });
}
