import { NextRequest, NextResponse } from "next/server";
import { translateBatch } from "@/lib/translate-context";
import type { ResearchBrief } from "@/lib/translate-context";
import type { SubtitleCue } from "@/lib/subtitle";
import { getCachedBrief, applyOverrides } from "@/lib/brief-cache";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/translate-cue
 *
 * Re-translate a SINGLE cue. Used by the per-cue "re-translate" button.
 * Does NOT count against the daily quota (it's fine-tuning, not a new
 * translation). Still requires login.
 *
 * Body: {
 *   cue: SubtitleCue,
 *   previous_cues: SubtitleCue[],
 *   brief: ResearchBrief,
 *   tmdb_id?, tmdb_media_type?, instruction?
 * }
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Please log in to translate subtitles." },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    cue?: SubtitleCue;
    previous_cues?: SubtitleCue[];
    brief?: ResearchBrief;
    tmdb_id?: number;
    tmdb_media_type?: "movie" | "tv";
    instruction?: string;
  };

  if (!body.cue) {
    return NextResponse.json({ error: "Missing 'cue'" }, { status: 400 });
  }
  if (!body.brief) {
    return NextResponse.json({ error: "Missing 'brief'" }, { status: 400 });
  }

  let apiKey: string;
  try {
    const { getApiKey } = await import("@/lib/ai-provider");
    apiKey = getApiKey();
  } catch {
    return NextResponse.json(
      { error: "AI service is not configured." },
      { status: 503 }
    );
  }

  let effectiveBrief = body.brief;
  if (body.tmdb_id && body.tmdb_media_type) {
    try {
      const cached = await getCachedBrief(body.tmdb_id, body.tmdb_media_type);
      if (cached) {
        effectiveBrief = applyOverrides(body.brief, cached.userOverrides);
      }
    } catch {
      // ignore — fall back to supplied brief
    }
  }

  if (body.instruction?.trim()) {
    effectiveBrief = {
      ...effectiveBrief,
      cultural_notes:
        (effectiveBrief.cultural_notes || "") +
        `\n\n[USER INSTRUCTION FOR THIS CUE] ${body.instruction.trim()}`,
    };
  }

  try {
    const translations = await translateBatch(
      {
        brief: effectiveBrief,
        previousCues: body.previous_cues ?? [],
        currentCues: [body.cue],
      },
      apiKey
    );
    return NextResponse.json({
      translation: translations[0] ?? "",
    });
  } catch (err: any) {
    const msg = err.message || "";
    let friendly = msg;
    if (msg.includes("401") || msg.includes("Authentication Fails")) {
      friendly = "Translation service authentication failed.";
    } else if (msg.includes("429")) {
      friendly = "Translation service is busy. Try again in a moment.";
    }
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
