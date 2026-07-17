import { NextRequest, NextResponse } from "next/server";
import { translateBatch } from "@/lib/translate-context";
import type { ResearchBrief } from "@/lib/translate-context";
import type { SubtitleCue } from "@/lib/subtitle";
import { getCachedBrief, applyOverrides } from "@/lib/brief-cache";
import { getCurrentUser } from "@/lib/auth";
import { checkCanTranslate, UsageLimitError } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/translate
 * Body: {
 *   cues: SubtitleCue[],       // current batch, untranslated
 *   previous_cues: SubtitleCue[],  // rolling context, already translated
 *   brief: ResearchBrief,      // from /api/research cache or live
 *   tmdb_id?: number,          // if provided, user overrides are loaded
 *   tmdb_media_type?: "movie" | "tv",
 *   deepseek_api_key?: string
 * }
 *
 * Returns: { translations: string[] }
 *
 * If tmdb_id + tmdb_media_type are provided AND a cached brief exists
 * for that title, the cached user overrides are applied to the brief's
 * glossary BEFORE translation. User overrides always win — if the same
 * English term appears in both, the override replaces the locked entry.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    cues?: SubtitleCue[];
    previous_cues?: SubtitleCue[];
    brief?: ResearchBrief;
    tmdb_id?: number;
    tmdb_media_type?: "movie" | "tv";
    deepseek_api_key?: string;
  };

  // Auth gate — must be logged in.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Please log in to translate subtitles." },
      { status: 401 }
    );
  }

  // Quota gate — free users limited to 1/day.
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

  if (!body.cues || !Array.isArray(body.cues) || body.cues.length === 0) {
    return NextResponse.json({ error: "Missing 'cues'" }, { status: 400 });
  }
  if (!body.brief) {
    return NextResponse.json({ error: "Missing 'brief'" }, { status: 400 });
  }

  // Use whatever AI provider is configured (DeepSeek or Gemini).
  let apiKey: string;
  try {
    const { getApiKey } = await import("@/lib/ai-provider");
    apiKey = getApiKey();
  } catch {
    return NextResponse.json(
      {
        error:
          "AI service is not configured. Please contact the site admin.",
      },
      { status: 503 }
    );
  }

  // Apply user overrides if a cached brief exists for this title.
  let effectiveBrief = body.brief;
  if (body.tmdb_id && body.tmdb_media_type) {
    try {
      const cached = await getCachedBrief(body.tmdb_id, body.tmdb_media_type);
      if (cached) {
        effectiveBrief = applyOverrides(body.brief, cached.userOverrides);
      }
    } catch (err) {
      // Non-fatal — fall back to the brief as supplied.
      console.error("[translate] failed to load overrides:", err);
    }
  }

  try {
    const translations = await translateBatch(
      {
        brief: effectiveBrief,
        previousCues: body.previous_cues ?? [],
        currentCues: body.cues,
      },
      apiKey
    );
    return NextResponse.json({
      translations,
      done: body.cues.length,
    });
  } catch (err: any) {
    const msg = err.message || "";
    let friendly = msg;
    if (msg.includes("401") || msg.includes("Authentication Fails")) {
      friendly = "AI service authentication failed. Please contact the site admin.";
    } else if (msg.includes("429") || msg.includes("rate limit")) {
      friendly = "AI rate limit hit. Wait 60 seconds and try again. (Gemini free tier: 15 RPM / 1500 RPD.)";
    }
    return NextResponse.json(
      { error: friendly },
      { status: 502 }
    );
  }
}
