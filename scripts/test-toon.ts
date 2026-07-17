// Sanity tests for TOON encoder/decoder.
// Run: bun /home/z/my-project/scripts/test-toon.ts

import { toonStringify, toonParse, toonStringifyWithStats } from "../src/lib/toon";

function assertEqual(a: unknown, b: unknown, label: string) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) {
    console.error(`✗ ${label}\n  expected: ${jb}\n  got:      ${ja}`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
}

// 1. Flat object with scalars.
const obj1 = {
  name: "Inception",
  year: 2010,
  rating: 8.8,
  watched: true,
  favourite: false,
  note: "A dream-within-a-dream heist movie",
};
// (No test change needed — the test just compares parse(stringify(x)) to x.
// We just verify booleans come back as booleans, regardless of literal form.)
const t1 = toonStringify(obj1);
console.log("\n--- TOON output (obj1) ---");
console.log(t1);
const p1 = toonParse(t1);
assertEqual(p1, obj1, "flat object round-trips");

// 2. Nested object + arrays.
const obj2 = {
  title: "Inception",
  cast: [
    { actor: "Leonardo DiCaprio", character: "Dom Cobb" },
    { actor: "Joseph Gordon-Levitt", character: "Arthur" },
  ],
  meta: {
    runtime: 148,
    genres: ["Action", "Sci-Fi"],
  },
  empty_arr: [] as unknown[],
  empty_obj: {},
};
const t2 = toonStringify(obj2);
console.log("\n--- TOON output (obj2) ---");
console.log(t2);
const p2 = toonParse(t2);
assertEqual(p2, obj2, "nested object + arrays round-trips");

// 3. Strings with special chars (newlines, backslashes).
const obj3 = {
  description: "Line 1\nLine 2\nLine 3",
  path: "C:\\Users\\test\\file.txt",
  combined: "Multi\n\\backslash",
};
const t3 = toonStringify(obj3);
console.log("\n--- TOON output (obj3) ---");
console.log(t3);
const p3 = toonParse(t3);
assertEqual(p3, obj3, "strings with newlines + backslashes round-trips");

// 4. Realistic subtitle batch payload.
const obj4 = {
  brief: {
    title: "Inception",
    tone: "Sci-fi thriller",
    register: "Colloquial",
    characters: [
      { name: "Dom Cobb", sinhala: "ඩොම් කොබ්" },
      { name: "Arthur", sinhala: "ආතර්" },
    ],
    glossary: [
      { en: "extraction", si: "නිස්කාශනය" },
      { en: "inception", si: "ආරම්භය" },
      { en: "limbo", si: "ලිම්බෝ" },
    ],
  },
  previous: [
    { start: "00:00:01,000", en: "What is the most resilient parasite?", si: "වඩාත්ම සවිමත් පරපෝෂිතය කුමක්ද?" },
  ],
  batch: [
    { idx: 1, start: "00:00:04,000", en: "An idea." },
    { idx: 2, start: "00:00:05,500", en: "Resilient, highly contagious." },
    { idx: 3, start: "00:00:07,000", en: "Once an idea has taken hold of the brain,\nit's almost impossible to eradicate." },
  ],
};
const stats = toonStringifyWithStats(obj4);
console.log("\n--- TOON vs JSON stats (subtitle payload) ---");
console.log(`JSON: ${stats.jsonChars} chars`);
console.log(`TOON: ${stats.toonChars} chars  (${stats.savings}% smaller)`);
console.log("\n--- TOON output ---");
console.log(stats.toon);
const p4 = toonParse(stats.toon);
assertEqual(p4, obj4, "realistic subtitle batch payload round-trips");

// 5. Comments are ignored.
const t5 = `
# This is a comment
title: Inception
year: 2010
`;
const p5 = toonParse(t5);
assertEqual(p5, { title: "Inception", year: 2010 }, "comments are ignored");

console.log("\nAll TOON tests passed! 🎉");
