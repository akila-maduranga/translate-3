import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/status
 *
 * Reports which server-side env vars are configured. Used by the UI to:
 *   - Show a small badge in the header (e.g. "TMDB ✓  DeepSeek ✓  DB ✓")
 *   - Decide whether to send client-supplied API keys in API requests
 *     (only needed if the server env is missing them)
 *
 * Returns boolean flags only — never the actual key values.
 */
export async function GET() {
  return NextResponse.json({
    tmdb: !!(process.env.TMDB_API_KEY || process.env.TMDB_READ_ACCESS_TOKEN),
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    database: !!process.env.DATABASE_URL,
    databaseIsPostgres:
      (process.env.DATABASE_URL || "").startsWith("postgres://") ||
      (process.env.DATABASE_URL || "").startsWith("postgresql://"),
  });
}
