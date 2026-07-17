/**
 * Server-side research brief cache.
 *
 * Wraps the Prisma `ResearchBriefCache` table with a clean API:
 *   - get(cacheKey)            → cached row or null
 *   - upsert(...)              → create or update by cacheKey
 *   - setUserOverrides(...)    → persist user-edited glossary overrides
 *   - listRecent()             → for a "recent briefs" UI
 *
 * All callers MUST be inside 'use server' / API routes — this file
 * touches the database directly and must never run on the client.
 */

import { db } from "@/lib/db";
import type { ResearchBrief, GlossaryEntry } from "@/lib/translate-context";

export interface BriefCacheRow {
  id: string;
  cacheKey: string;
  tmdbId: number;
  tmdbMediaType: string;
  title: string;
  rawMarkdown: string;
  brief: ResearchBrief;
  userOverrides: GlossaryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

function makeCacheKey(tmdbId: number, tmdbMediaType: string): string {
  return `${tmdbMediaType}-${tmdbId}`;
}

function rowToBriefCacheRow(row: {
  id: string;
  cacheKey: string;
  tmdbId: number;
  tmdbMediaType: string;
  title: string;
  rawMarkdown: string;
  briefJson: string;
  userOverrides: string;
  createdAt: Date;
  updatedAt: Date;
}): BriefCacheRow {
  let brief: ResearchBrief;
  try {
    brief = JSON.parse(row.briefJson) as ResearchBrief;
  } catch {
    // Fall back to an empty brief — caller can re-derive on demand.
    brief = {
      summary: "",
      setting: "",
      tone: "",
      register: "",
      characters: [],
      locations: [],
      recurring_phrases: [],
      proper_nouns: [],
      cultural_notes: "",
      glossary: [],
    };
  }
  let overrides: GlossaryEntry[];
  try {
    overrides = JSON.parse(row.userOverrides || "[]") as GlossaryEntry[];
  } catch {
    overrides = [];
  }
  return {
    id: row.id,
    cacheKey: row.cacheKey,
    tmdbId: row.tmdbId,
    tmdbMediaType: row.tmdbMediaType,
    title: row.title,
    rawMarkdown: row.rawMarkdown,
    brief,
    userOverrides: overrides,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCachedBrief(
  tmdbId: number,
  tmdbMediaType: string
): Promise<BriefCacheRow | null> {
  const cacheKey = makeCacheKey(tmdbId, tmdbMediaType);
  const row = await db.researchBriefCache.findUnique({ where: { cacheKey } });
  if (!row) return null;
  return rowToBriefCacheRow(row);
}

export async function upsertCachedBrief(params: {
  tmdbId: number;
  tmdbMediaType: string;
  title: string;
  rawMarkdown: string;
  brief: ResearchBrief;
}): Promise<BriefCacheRow> {
  const cacheKey = makeCacheKey(params.tmdbId, params.tmdbMediaType);
  const row = await db.researchBriefCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      tmdbId: params.tmdbId,
      tmdbMediaType: params.tmdbMediaType,
      title: params.title,
      rawMarkdown: params.rawMarkdown,
      briefJson: JSON.stringify(params.brief),
      userOverrides: "[]",
    },
    update: {
      title: params.title,
      rawMarkdown: params.rawMarkdown,
      briefJson: JSON.stringify(params.brief),
      // Preserve userOverrides on update.
    },
  });
  return rowToBriefCacheRow(row);
}

export async function setUserOverrides(
  tmdbId: number,
  tmdbMediaType: string,
  overrides: GlossaryEntry[]
): Promise<BriefCacheRow> {
  const cacheKey = makeCacheKey(tmdbId, tmdbMediaType);
  // Upsert with empty brief if the row doesn't exist yet — caller
  // should normally have already created it via /api/research.
  const existing = await db.researchBriefCache.findUnique({ where: { cacheKey } });
  if (!existing) {
    throw new Error(
      "Cannot set user overrides before the research brief has been generated."
    );
  }
  const row = await db.researchBriefCache.update({
    where: { cacheKey },
    data: { userOverrides: JSON.stringify(overrides) },
  });
  return rowToBriefCacheRow(row);
}

export async function listRecentBriefs(limit = 20): Promise<BriefCacheRow[]> {
  const rows = await db.researchBriefCache.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows.map(rowToBriefCacheRow);
}

export async function deleteCachedBrief(
  tmdbId: number,
  tmdbMediaType: string
): Promise<void> {
  const cacheKey = makeCacheKey(tmdbId, tmdbMediaType);
  await db.researchBriefCache.deleteMany({ where: { cacheKey } });
}

/**
 * Merge a brief's locked glossary with the user's overrides.
 * User overrides ALWAYS win — if the same English term appears in
 * both, the override replaces the locked entry.
 *
 * Used by /api/translate so the glossary the translator sees is the
 * effective one after the user's manual edits.
 */
export function applyOverrides(
  brief: ResearchBrief,
  overrides: GlossaryEntry[]
): ResearchBrief {
  if (!overrides || overrides.length === 0) return brief;
  const overrideMap = new Map<string, GlossaryEntry>();
  for (const o of overrides) {
    if (o.english && o.sinhala) {
      overrideMap.set(o.english.toLowerCase().trim(), o);
    }
  }
  const merged = brief.glossary.map((g) => {
    const o = overrideMap.get(g.english.toLowerCase().trim());
    return o ? { ...o } : g;
  });
  // Append overrides that don't match any existing entry.
  for (const o of overrides) {
    const exists = brief.glossary.some(
      (g) => g.english.toLowerCase().trim() === o.english.toLowerCase().trim()
    );
    if (!exists && o.english && o.sinhala) merged.push(o);
  }
  return { ...brief, glossary: merged };
}
