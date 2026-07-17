import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getUsageStatus } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/usage — returns the current user's daily quota + usage. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }
  const status = await getUsageStatus(user.id, user.role);
  return NextResponse.json(status);
}
