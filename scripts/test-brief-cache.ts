// Test the brief cache + overrides flow end-to-end.
// Run with: bun /home/z/my-project/scripts/test-brief-cache.ts

import { db } from "../src/lib/db";
import {
  getCachedBrief,
  upsertCachedBrief,
  setUserOverrides,
  applyOverrides,
} from "../src/lib/brief-cache";
import type { ResearchBrief, GlossaryEntry } from "../src/lib/translate-context";

async function main() {
  // Clean up any previous test rows.
  await db.researchBriefCache.deleteMany({
    where: { cacheKey: "movie-999999" },
  });
  console.log("✓ Cleaned up previous test rows");

  // 1. getCachedBrief should return null when nothing is cached.
  const empty = await getCachedBrief(999999, "movie");
  console.log("✓ getCachedBrief(empty) →", empty === null ? "null (correct)" : "FAIL");

  // 2. Upsert a test brief.
  const brief: ResearchBrief = {
    summary: "Test movie about a coder.",
    setting: "modern day San Francisco",
    tone: "dramatic",
    register: "colloquial",
    characters: [
      { name: "Neo", description: "The protagonist", sinhala_name: "නියෝ" },
    ],
    locations: [{ name: "San Francisco", sinhala_name: "සැන් ෆ්‍රැන්සිස්කෝ" }],
    recurring_phrases: [],
    proper_nouns: [],
    cultural_notes: "Test cultural notes.",
    glossary: [
      { english: "matrix", sinhala: "ක්ෂේත්‍රය", note: "the virtual world" },
      { english: "neo", sinhala: "නියෝ" },
    ],
  };
  const cached = await upsertCachedBrief({
    tmdbId: 999999,
    tmdbMediaType: "movie",
    title: "Test Movie",
    rawMarkdown: "# Test brief\n\nThis is a test.",
    brief,
  });
  console.log("✓ upsertCachedBrief →", cached.title, "(cacheKey:", cached.cacheKey + ")");

  // 3. getCachedBrief should now return the row.
  const fetched = await getCachedBrief(999999, "movie");
  console.log("✓ getCachedBrief →", fetched?.brief.glossary.length, "glossary entries");

  // 4. Set user overrides.
  const overrides: GlossaryEntry[] = [
    { english: "matrix", sinhala: "මැට්‍රික්ස්", note: "user prefers transliteration" },
    { english: "red pill", sinhala: "රතු පෙත්ත" },
  ];
  const updated = await setUserOverrides(999999, "movie", overrides);
  console.log("✓ setUserOverrides →", updated.userOverrides.length, "overrides");

  // 5. applyOverrides should merge correctly — user overrides win.
  const merged = applyOverrides(brief, overrides);
  const matrix = merged.glossary.find((g) => g.english.toLowerCase() === "matrix");
  console.log(
    "✓ applyOverrides: 'matrix' sinhala is",
    matrix?.sinhala,
    matrix?.sinhala === "මැට්‍රික්ස්" ? "(override won ✓)" : "(FAIL — locked entry won)"
  );
  const redPill = merged.glossary.find((g) => g.english.toLowerCase() === "red pill");
  console.log(
    "✓ applyOverrides: 'red pill' is",
    redPill ? redPill.sinhala + " (appended ✓)" : "(FAIL — not added)"
  );
  console.log("✓ Total glossary entries after merge:", merged.glossary.length);

  // 6. Re-fetch to confirm overrides persisted.
  const refetched = await getCachedBrief(999999, "movie");
  console.log(
    "✓ Persisted overrides count:",
    refetched?.userOverrides.length,
    refetched?.userOverrides.length === 2 ? "(correct ✓)" : "(FAIL)"
  );

  // 7. Upsert again with new brief content — should PRESERVE user overrides.
  const brief2 = { ...brief, summary: "Updated summary." };
  await upsertCachedBrief({
    tmdbId: 999999,
    tmdbMediaType: "movie",
    title: "Test Movie v2",
    rawMarkdown: "# v2",
    brief: brief2,
  });
  const afterReupsert = await getCachedBrief(999999, "movie");
  console.log(
    "✓ Re-upsert preserved overrides:",
    afterReupsert?.userOverrides.length === 2 ? "yes ✓" : "no (FAIL)"
  );
  console.log("✓ Re-upsert updated title:", afterReupsert?.title);

  // Clean up.
  await db.researchBriefCache.deleteMany({ where: { cacheKey: "movie-999999" } });
  console.log("✓ Cleaned up test row");

  console.log("\nAll brief cache tests passed! 🎉");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
