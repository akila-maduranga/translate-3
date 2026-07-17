import { NextRequest, NextResponse } from "next/server";
import { getCachedBrief, setUserOverrides } from "@/lib/brief-cache";
import { getCurrentUser } from "@/lib/auth";
import type { GlossaryEntry } from "@/lib/translate-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/brief/overrides?tmdb_id=...&tmdb_media_type=... — requires login. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please log in." }, { status: 401 });
  }
  const url = new URL(req.url);
  const tmdbId = parseInt(url.searchParams.get("tmdb_id") ?? "0", 10);
  const tmdbMediaType = (url.searchParams.get("tmdb_media_type") ?? "") as
    | "movie"
    | "tv";
  if (!tmdbId || !tmdbMediaType) {
    return NextResponse.json(
      { error: "Missing tmdb_id or tmdb_media_type" },
      { status: 400 }
    );
  }
  const cached = await getCachedBrief(tmdbId, tmdbMediaType);
  if (!cached) return NextResponse.json({ overrides: [] });
  return NextResponse.json({ overrides: cached.userOverrides });
}

/** POST /api/brief/overrides — requires login. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please log in." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    tmdb_id?: number;
    tmdb_media_type?: "movie" | "tv";
    overrides?: GlossaryEntry[];
  };
  if (!body.tmdb_id || !body.tmdb_media_type || !Array.isArray(body.overrides)) {
    return NextResponse.json(
      { error: "Missing tmdb_id, tmdb_media_type, or overrides" },
      { status: 400 }
    );
  }
  const clean = body.overrides.filter(
    (o) => o.english?.trim() && o.sinhala?.trim()
  );
  try {
    const row = await setUserOverrides(body.tmdb_id, body.tmdb_media_type, clean);
    return NextResponse.json({ ok: true, overrides: row.userOverrides });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
