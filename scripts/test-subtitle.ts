// Quick sanity test for the SRT parser & serializer.
// Run with: bun /home/z/my-project/scripts/test-subtitle.ts

import {
  parseSubtitles,
  serializeSubtitles,
  detectFormat,
  formatTimestamp,
  parseTimestamp,
} from "../src/lib/subtitle";

const sample = `1
00:00:01,000 --> 00:00:04,000
The world we live in is not what it seems.

2
00:00:05,000 --> 00:00:08,500
There are things moving in the shadows,
things that ordinary people cannot see.

3
00:00:09,000 --> 00:00:12,000
- What do you want from me?
- I want you to remember.

4
00:00:13,000 --> 00:00:16,000
This is the moment when everything changes.
`;

const fmt = detectFormat("test.srt");
console.log("Detected format:", fmt);

const cues = parseSubtitles(sample, fmt);
console.log(`Parsed ${cues.length} cues`);
for (const c of cues) {
  console.log(`  [${c.index}] ${c.startRaw} -> ${c.endRaw} : ${c.text.replace(/\n/g, " / ")}`);
}

// Round-trip test
const serialized = serializeSubtitles(cues, fmt);
const reparsed = parseSubtitles(serialized, fmt);
console.log("\nRound-trip:");
console.log("  Cues match:", cues.length === reparsed.length);
console.log("  Timestamps match:", cues.every((c, i) =>
  c.start === reparsed[i].start && c.end === reparsed[i].end
));
console.log("  Text match:", cues.every((c, i) => c.text === reparsed[i].text));

// VTT round-trip with translated text
const vttCues = cues.map((c, i) => ({
  ...c,
  translated: `සිංහල පරිවර්තනය ${i + 1}`,
}));
const vttOut = serializeSubtitles(vttCues, "vtt");
console.log("\nVTT with translations (first 12 lines):");
console.log(vttOut.split("\n").slice(0, 12).join("\n"));

// Timestamp format check
console.log("\nTimestamp formatting:");
console.log("  1.5s as srt:", formatTimestamp(1.5, "srt"));     // 00:00:01,500
console.log("  1.5s as vtt:", formatTimestamp(1.5, "vtt"));     // 00:00:01.500
console.log("  3661.123s as srt:", formatTimestamp(3661.123, "srt")); // 01:01:01,123
console.log("  Parse '01:01:01,123':", parseTimestamp("01:01:01,123")); // 3661.123
console.log("  Parse '00:00:01.500':", parseTimestamp("00:00:01.500")); // 1.5
