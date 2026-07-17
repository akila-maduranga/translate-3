import { NextRequest, NextResponse } from "next/server";
import { getCachedBrief } from "@/lib/brief-cache";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/brief/get?tmdb_id=...&tmdb_media_type=... — requires login. */
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
  if (!cached) {
    return NextResponse.json(
      { cached: false, message: "No brief cached for this title yet." },
      { status: 404 }
    );
  }
  return NextResponse.json({
    cached: true,
    title: cached.title,
    brief: cached.brief,
    overrides: cached.userOverrides,
    updatedAt: cached.updatedAt,
  });
}
