import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { recordTranslation, checkCanTranslate, UsageLimitError } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/record
 *
 * Records a completed translation job and increments the user's daily
 * usage counter. Called by the client after the "Translate All" job
 * finishes successfully.
 *
 * Body: {
 *   title, cueCount, translatedCount, source, format, durationMs
 * }
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    cueCount?: number;
    translatedCount?: number;
    source?: "tmdb" | "ai";
    format?: "srt" | "vtt";
    durationMs?: number;
  };

  if (!body.title || !body.cueCount || !body.source || !body.format) {
    return NextResponse.json(
      { error: "Missing required fields." },
      { status: 400 }
    );
  }

  // Check quota BEFORE recording (in case the user is at the limit).
  try {
    await checkCanTranslate(user.id, user.role);
  } catch (err: any) {
    if (err instanceof UsageLimitError) {
      return NextResponse.json(
        { error: err.message, limit: err.status },
        { status: 429 }
      );
    }
    throw err;
  }

  await recordTranslation({
    userId: user.id,
    role: user.role,
    title: body.title,
    cueCount: body.cueCount,
    translatedCount: body.translatedCount ?? body.cueCount,
    source: body.source,
    format: body.format,
    durationMs: body.durationMs ?? 0,
  });

  return NextResponse.json({ ok: true });
}
