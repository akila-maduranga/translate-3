import { NextRequest, NextResponse } from "next/server";
import { getMovieDetails, getTvDetails, buildContextBundle } from "@/lib/tmdb";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/tmdb/details?id=...&type=movie|tv — requires login. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please log in." }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") ?? "0", 10);
  const type = (url.searchParams.get("type") ?? "movie") as "movie" | "tv";
  const apiKey = process.env.TMDB_API_KEY || process.env.TMDB_READ_ACCESS_TOKEN || "";

  if (!id) return NextResponse.json({ error: "Missing 'id'" }, { status: 400 });
  if (!apiKey) {
    return NextResponse.json(
      { error: "Movie search is not configured." },
      { status: 503 }
    );
  }

  try {
    const details =
      type === "movie"
        ? await getMovieDetails(id, apiKey)
        : await getTvDetails(id, apiKey);
    const context_bundle = buildContextBundle(details, type);
    return NextResponse.json({ details, context_bundle });
  } catch (err: any) {
    const msg = err.message || "";
    let friendly = msg;
    if (msg.includes("401")) {
      friendly = "Movie search is not configured correctly.";
    }
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
