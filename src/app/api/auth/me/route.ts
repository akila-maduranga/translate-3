import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/me — returns the currently logged-in user, or null. */
export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}
