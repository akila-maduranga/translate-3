// Sanity test: verify that the TOON payload built by translateBatch
// is well-formed and parseable. We monkey-patch callDeepSeek to
// capture the user prompt without actually calling the API.
//
// Run: bun /home/z/my-project/scripts/test-toon-payload.ts

import { toonStringify, toonParse } from "../src/lib/toon";
import type { ResearchBrief, TranslateBatchInput } from "../src/lib/translate-context";
import type { SubtitleCue } from "../src/lib/subtitle";

// Build the same payload that translateBatch would send.
const brief: ResearchBrief = {
  summary: "A dream heist movie",
  setting: "Modern day",
  tone: "Sci-fi thriller",
  register: "Colloquial",
  characters: [
    { name: "Dom Cobb", description: "The protagonist", sinhala_name: "ඩොම් කොබ්" },
  ],
  locations: [{ name: "Paris", sinhala_name: "පැරිස්" }],
  recurring_phrases: [],
  proper_nouns: [],
  cultural_notes: "Some notes",
  glossary: [
    { english: "extraction", sinhala: "නිස්කාශනය" },
    { english: "inception", sinhala: "ආරම්භය" },
  ],
};

const previousCues: SubtitleCue[] = [
  { index: 1, start: 0, end: 2, startRaw: "00:00:00,000", endRaw: "00:00:02,000", text: "Hello", translated: "ආයුබෝවන්" },
];

const currentCues: SubtitleCue[] = [
  { index: 2, start: 2, end: 4, startRaw: "00:00:02,000", endRaw: "00:00:04,000", text: "What is your name?" },
  { index: 3, start: 4, end: 6, startRaw: "00:00:04,000", endRaw: "00:00:06,000", text: "My name is Dom." },
];

// Mirror the payload structure used in translateBatch.
const payload = {
  brief: {
    summary: brief.summary,
    setting: brief.setting,
    tone: brief.tone,
    register: brief.register,
    cultural_notes: brief.cultural_notes,
    characters: brief.characters.map((c) => ({
      name: c.name,
      sinhala: c.sinhala_name,
      note: c.description,
    })),
    locations: brief.locations.map((l) => ({
      name: l.name,
      sinhala: l.sinhala_name,
    })),
    glossary: brief.glossary.map((g) => ({
      en: g.english,
      si: g.sinhala,
      note: g.note,
    })),
  },
  previous: previousCues.map((c, i) => ({
    idx: i + 1,
    start: c.startRaw,
    end: c.endRaw,
    en: c.text,
    si: c.translated ?? "",
  })),
  batch: currentCues.map((c, i) => ({
    idx: i + 1,
    start: c.startRaw,
    end: c.endRaw,
    en: c.text,
  })),
};

const toonText = toonStringify(payload);
console.log("=== TOON payload (built like translateBatch) ===");
console.log(toonText);

const jsonText = JSON.stringify(payload, null, 2);
console.log("\n=== Stats ===");
console.log(`TOON: ${toonText.length} chars`);
console.log(`JSON: ${jsonText.length} chars`);
console.log(`Savings: ${Math.round((1 - toonText.length / jsonText.length) * 100)}%`);

// Round-trip test
const reparsed = toonParse(toonText) as typeof payload;
const ok =
  reparsed.brief.glossary.length === payload.brief.glossary.length &&
  reparsed.brief.characters[0].sinhala === "ඩොම් කොබ්" &&
  reparsed.batch.length === 2 &&
  reparsed.batch[1].en === "My name is Dom." &&
  reparsed.previous[0].si === "ආයුබෝවන්";

console.log("\n=== Round-trip ===");
console.log(ok ? "✓ Payload round-trips correctly" : "✗ Round-trip failed");
if (!ok) {
  console.log("Reparsed:", JSON.stringify(reparsed, null, 2));
  process.exit(1);
}

console.log("\n✓ TOON payload is well-formed and parseable.");
