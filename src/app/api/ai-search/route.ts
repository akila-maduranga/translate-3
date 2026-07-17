import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/ai-provider";
import type { TranslationContextBundle } from "@/lib/tmdb";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonFromLlm } from "@/lib/json-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai-search
 *
 * AI fallback for movie lookup — used when TMDB isn't configured or
 * returns no results. Requires login.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please log in." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
  };

  if (!body.query?.trim()) {
    return NextResponse.json({ error: "Missing 'query'" }, { status: 400 });
  }

  // Use whatever AI provider is configured (DeepSeek or Gemini).
  try {
    const { getApiKey } = await import("@/lib/ai-provider");
    getApiKey(); // throws if not configured
  } catch {
    return NextResponse.json(
      { error: "AI service is not configured. Please contact the site admin." },
      { status: 503 }
    );
  }

  const systemPrompt = `You are a movie & TV identification assistant for a Sinhala subtitle translation tool.

The user will give you a free-text query (a title, a description, a quote, a partial plot, etc.). Your job is to identify the most likely movie or TV show and return enough metadata to drive a translation brief.

Return JSON ONLY — no prose. Schema:
{
  "results": [
    {
      "title": string,
      "media_type": "movie" | "tv",
      "release_year": string,
      "runtime_minutes": number | null,
      "genres": string[],
      "tagline": string,
      "overview": string,
      "cast": [{ "actor": string, "character": string }],
      "directors": string[],
      "writers": string[],
      "keywords": string[],
      "production_countries": string[],
      "spoken_languages": string[],
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Rules:
  1. Return 1-3 results, most-likely first.
  2. If you genuinely cannot identify the title, return an empty results array.
  3. Do NOT invent cast, plot, or characters you are not confident about.`;

  const userPrompt = `Identify this movie/TV show and return its metadata as JSON:\n\n"${body.query}"\n\nReturn JSON now.`;

  try {
    const result = await callAI({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      jsonMode: true,
      maxTokens: 2500,
    });

    let parsed: {
      results?: Array<{
        title: string;
        media_type: "movie" | "tv";
        release_year?: string;
        runtime_minutes?: number | null;
        genres?: string[];
        tagline?: string;
        overview?: string;
        cast?: { actor: string; character: string }[];
        directors?: string[];
        writers?: string[];
        keywords?: string[];
        production_countries?: string[];
        spoken_languages?: string[];
        confidence?: string;
      }>;
    };
    try {
      parsed = parseJsonFromLlm<typeof parsed>(result.content);
    } catch {
      return NextResponse.json(
        { error: "Could not identify the movie. Try a different query." },
        { status: 502 }
      );
    }

    const results: Array<
      TranslationContextBundle & { confidence?: string }
    > = (parsed.results ?? []).map((r) => ({
      media_type: r.media_type === "tv" ? "tv" : "movie",
      title: r.title || "Unknown",
      original_title: r.title,
      release_year: r.release_year ?? "",
      runtime_minutes: r.runtime_minutes ?? null,
      genres: r.genres ?? [],
      tagline: r.tagline ?? "",
      overview: r.overview ?? "",
      cast: (r.cast ?? []).slice(0, 10).map((c) => ({
        actor: c.actor,
        character: c.character,
      })),
      directors: r.directors ?? [],
      writers: r.writers ?? [],
      keywords: r.keywords ?? [],
      production_countries: r.production_countries ?? [],
      spoken_languages: r.spoken_languages ?? [],
      poster_url: "",
      backdrop_url: "",
      confidence: r.confidence,
    }));

    return NextResponse.json({ results, source: "ai" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
