// Test the robust JSON parser against common LLM output quirks.
// Run: bun /home/z/my-project/scripts/test-json-parser.ts

import { parseJsonFromLlm } from "../src/lib/json-parser";

function assertEqual(a: unknown, b: unknown, label: string) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) {
    console.error(`✗ ${label}\n  expected: ${jb}\n  got:      ${ja}`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
}

// 1. Plain JSON (fast path)
const plain = '{"name": "Inception", "year": 2010}';
assertEqual(parseJsonFromLlm(plain), { name: "Inception", year: 2010 }, "plain JSON");

// 2. Markdown code fence
const fenced = "```json\n{\"name\": \"Inception\", \"year\": 2010}\n```";
assertEqual(parseJsonFromLlm(fenced), { name: "Inception", year: 2010 }, "markdown json fence");

// 3. Markdown code fence without language tag
const fencedPlain = "```\n{\"name\": \"Inception\", \"year\": 2010}\n```";
assertEqual(parseJsonFromLlm(fencedPlain), { name: "Inception", year: 2010 }, "markdown plain fence");

// 4. Preamble before JSON
const preamble = "Here is the JSON for the movie brief:\n\n{\"name\": \"Inception\", \"year\": 2010}";
assertEqual(parseJsonFromLlm(preamble), { name: "Inception", year: 2010 }, "preamble before JSON");

// 5. Trailing note after JSON
const trailing = '{"name": "Inception", "year": 2010}\n\nLet me know if you need any changes!';
assertEqual(parseJsonFromLlm(trailing), { name: "Inception", year: 2010 }, "trailing note after JSON");

// 6. V4 thinking preamble (common with reasoning mode)
const thinking = "I'll analyze this movie and provide the brief.\n\n{\"name\": \"Inception\", \"year\": 2010}";
assertEqual(parseJsonFromLlm(thinking), { name: "Inception", year: 2010 }, "thinking preamble before JSON");

// 7. JSON with nested objects
const nested = '{"movie": {"title": "Inception"}, "characters": [{"name": "Cobb"}]}';
assertEqual(
  parseJsonFromLlm(nested),
  { movie: { title: "Inception" }, characters: [{ name: "Cobb" }] },
  "nested JSON"
);

// 8. Fence with nested JSON + trailing text
const complex = "```json\n{\"summary\": \"A heist movie\", \"glossary\": [{\"en\": \"extraction\", \"si\": \"නිස්කාශනය\"}]}\n```\n\nThis brief covers the main terminology.";
assertEqual(
  parseJsonFromLlm(complex),
  { summary: "A heist movie", glossary: [{ en: "extraction", si: "නිස්කාශනය" }] },
  "fence + nested + trailing"
);

// 9. Empty input throws
try {
  parseJsonFromLlm("");
  console.error("✗ empty input should throw");
  process.exit(1);
} catch {
  console.log("✓ empty input throws");
}

// 10. Non-JSON input throws with helpful preview
try {
  parseJsonFromLlm("Sorry, I can't help with that.");
  console.error("✗ non-JSON input should throw");
  process.exit(1);
} catch (err: any) {
  console.log(`✓ non-JSON input throws with preview: "${err.message.slice(0, 60)}..."`);
}

// 11. Sinhala text inside JSON
const sinhala = '{"title": "ඉන්සෙප්ෂන්", "greeting": "ආයුබෝවන්"}';
assertEqual(
  parseJsonFromLlm(sinhala),
  { title: "ඉන්සෙප්ෂන්", greeting: "ආයුබෝවන්" },
  "Sinhala text inside JSON"
);

// 12. V4 typical output — fence + preamble + complex JSON
const v4typical = `I'll analyze "Inception" (2010) and provide the translation brief.

\`\`\`json
{
  "summary": "A skilled thief who steals secrets from dreams is offered a chance at redemption.",
  "tone": "Sci-fi thriller, mind-bending",
  "characters": [
    {"name": "Dom Cobb", "sinhala_name": "ඩොම් කොබ්", "speech_style": "casual, decisive"}
  ]
}
\`\`\`

This brief captures the movie's key characters and tone.`;
const parsed = parseJsonFromLlm<{ summary: string; tone: string; characters: any[] }>(v4typical);
console.log(`✓ V4 typical output parses — summary: "${parsed.summary.slice(0, 30)}...", ${parsed.characters.length} characters`);

console.log("\nAll JSON parser tests passed! 🎉");
