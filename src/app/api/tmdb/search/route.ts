import { NextRequest, NextResponse } from "next/server";
import { searchMulti } from "@/lib/tmdb";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tmdb/search?query=...&page=1
 *
 * Searches TMDB for movies and TV shows using the server-side
 * TMDB_API_KEY env var. Requires login.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Please log in to search." }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get("query")?.trim() ?? "";
  const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const apiKey = process.env.TMDB_API_KEY || process.env.TMDB_READ_ACCESS_TOKEN || "";

  if (!query) {
    return NextResponse.json({ error: "Missing 'query' parameter" }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json(
      { error: "Movie search is not configured. Please contact the site admin." },
      { status: 503 }
    );
  }

  try {
    const result = await searchMulti(query, apiKey, page);
    return NextResponse.json(result);
  } catch (err: any) {
    const msg = err.message || "";
    let friendly = msg;
    if (msg.includes("401") || msg.includes("Invalid API key")) {
      friendly = "Movie search is not configured correctly. Please contact the site admin.";
    } else if (msg.includes("429")) {
      friendly = "Movie search is busy. Please try again in a moment.";
    }
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
