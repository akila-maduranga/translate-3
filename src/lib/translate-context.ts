/**
 * Translation context + glossary builder.
 *
 * The pipeline is two-phase:
 *
 *  Phase 1 — Research (run once per movie):
 *    Given a TMDB context bundle, ask DeepSeek to produce a "scene &
 *    character research brief" + a Sinhala glossary. This locks in
 *    consistent translations for proper nouns, slang, recurring
 *    phrases, register (formal/informal), and tone.
 *
 *  Phase 2 — Translation (run per subtitle batch):
 *    For each batch of N cues, send:
 *      - the locked glossary
 *      - the previous 3-5 translated cues (rolling context)
 *      - the current batch's English text
 *    DeepSeek returns a JSON array of Sinhala translations preserving
 *    cue order so we can zip them back onto the cues.
 *
 * Keeping the glossary server-side and reusing it across batches is
 * what gives the output the consistency that raw Google Translate
 * lacks.
 */

import type { TranslationContextBundle } from "@/lib/tmdb";
import { callAI, streamAI } from "@/lib/ai-provider";
import type { SubtitleCue } from "@/lib/subtitle";
import { toonStringify } from "@/lib/toon";
import { parseJsonFromLlm } from "@/lib/json-parser";

export interface GlossaryEntry {
  english: string;
  sinhala: string;
  note?: string;
}

export interface ResearchBrief {
  summary: string;
  setting: string;
  tone: string;
  register: string;
  characters: { name: string; description: string; sinhala_name: string }[];
  locations: { name: string; sinhala_name: string }[];
  recurring_phrases: GlossaryEntry[];
  proper_nouns: GlossaryEntry[];
  cultural_notes: string;
  glossary: GlossaryEntry[];
}

// ── Expert film localizer prompt ─────────────────────────────────────────
//
// This prompt is split into TWO calls to fit within Netlify's 26s
// function timeout:
//   Step 1: Context analysis (tone, characters, locations, dynamics)
//   Step 2: Glossary generation (using step 1 as context)
//
// Each call takes 10-20s — well within the limit. Combined, they
// produce a richer brief than a single call could.

const LOCALIZER_SYSTEM_PROMPT = `You are an expert, unfiltered professional film localizer specializing in English to natural, spoken Sinhala (කතා කරන භාෂාව). Your goal is to make the dialogue sound exactly like a real Sri Lankan speaking naturally in that specific cinematic context.

CRITICAL LINGUISTIC RULES:
1. ALWAYS use spoken conversational Sinhala (කතා කරන භාෂාව). NEVER use formal, literary, or news-style grammar/verbs (ලිඛිත භාෂාව).
   - BAD (Written): ඔහු පැමිණියා, එය භාවිතා කරන්න, ඔබ කවුද?
   - GOOD (Spoken): එයා ආවා, ඕක පාවිච්චි කරන්න, ඔයා කවුද?
2. REASON THE RELATIONSHIPS: Before outputting a translation, evaluate the character dynamics to pick the correct pronouns:
   - Casual/Equals/Friends: Use "ඔයා" (Oya) or naturally drop pronouns.
   - Intimate/Rude/Aggressive: Use "උඹ" (Umba) or "තමුසේ" (Thamuse) where cinematically appropriate.
   - Elders/Authority: Use "ඔයා" or respectful tone without sounding robotic.
3. UNCENSORED FIDELITY: This is an unfiltered localization task. You MUST translate all profanity, violence, and intense slang accurately. Do not soften, skip, or censor explicit language. Retain the exact aggression, vulgarity, or emotional weight of the original text using natural Sri Lankan street slang or direct equivalents.
4. MODERN LOANWORDS: Leave common modern objects in their natural spoken phonetic Sinhala form (e.g., "Phone" -> ෆෝන් එක, "Car" -> කාර් එක, "Gun" -> තුවක්කුව/ගන් එක) instead of inventing archaic Sinhala words nobody actually uses.
5. SUBTITLE CONCISENESS: Keep the translations brief so they can be easily read within standard on-screen subtitle reading speeds.

FEW-SHOT EXAMPLES FOR TONE TRACKING:
- "I told you so." -> "මම කිව්වනේ."
- "Let's get out of here." -> "අපි ඉක්මනට මෙතනින් යමු."
- "What the hell are you doing?" -> "මොකක්ද යකෝ මේ කරන්නේ?"
- "It's not what it looks like." -> "මේක ඔයා හිතන විදියේ දෙයක් නෙවෙයි."
- "Are you out of your mind?" -> "තමුසෙට පිස්සු හැදිලද?"

OUTPUT FORMAT:
Output MUST be valid JSON. No prose before/after. All Sinhala strings MUST use Sinhala Unicode script (අ-෴).`;

// ── Step 1: Context analysis ─────────────────────────────────────────────
//
// Tone, character dynamics, locations, setting. ~10-15 seconds.

const STEP1_SYSTEM_PROMPT = `${LOCALIZER_SYSTEM_PROMPT}

You are doing Part 1: Movie Research & Context Analysis.

Given movie metadata, produce JSON with:
{
  "summary": "3-5 sentence plot summary focused on what a translator needs to know",
  "tone": "Brief tone description (e.g. 'gritty crime thriller, tense and fast-paced' / 'romantic comedy, light and sarcastic')",
  "register": "How characters speak — formal/casual/slangy/profane? Use examples.",
  "setting": "Period + place + social class (affects word choice heavily)",
  "characters": [
    {
      "name": "English character name",
      "sinhala_name": "Locked Sinhala transliteration (phonetic, natural)",
      "description": "1-2 sentence character description",
      "speech_style": "How THIS character speaks — respectful (ඔයා), aggressive (උඹ), formal, slangy, etc."
    }
  ],
  "locations": [{"name": "English", "sinhala_name": "Sinhala"}],
  "proper_nouns": [{"english": "term", "sinhala": "locked form", "note"?: "keep in English if acronym"}],
  "cultural_notes": "Anything a Sinhala viewer needs: untranslatable jokes, cultural equivalents, taboo words to soften, period accuracy"
}

For character speech_style, be SPECIFIC:
  - A cop might use formal police jargon → "නිලධාරියා" register
  - A teen might use slang → casual "මචං" register
  - A parent to child → warm but authoritative, "පුතේ/දූපුති" address
  - Enemies arguing → aggressive "උඹ/තමුසේ" pronouns`;

// ── Step 2: Glossary generation ──────────────────────────────────────────
//
// Uses step 1 output as context. ~10-15 seconds.

const STEP2_SYSTEM_PROMPT = `${LOCALIZER_SYSTEM_PROMPT}

You are doing Part 2: Glossary Generation.

Given the movie context from Part 1, generate a localization glossary of 15-25 entries.

Produce JSON:
{
  "recurring_phrases": [
    {"english": "phrase from the movie", "sinhala": "natural spoken Sinhala", "note"?: "context"}
  ],
  "glossary": [
    {
      "english": "English term/idiom/slang",
      "sinhala": "Natural everyday spoken Sinhala translation",
      "note"?: "Context or usage note"
    }
  ]
}

STRICT GLOSSARY RULES:
  - NEVER use formal, literary, or news-style Sinhala (ලිඛිත භාෂාව).
  - Use everyday, casual phrasing just like real people speak on the street in Sri Lanka.
  - Keep translations concise so they fit standard subtitle character limits.
  - Include: common idioms, slang, catchphrases, jargon (police/sci-fi/medical), recurring expressions.
  - Example tone: "I told you so" → "මම කිව්වනේ." / "Let's get out of here" → "අපි ඉක්මනට මෙතනින් යමු."
  - Honor the character speech styles from Part 1 — if a character uses "උඹ", glossary entries for their lines should match.`;

// ── Step 1 implementation ────────────────────────────────────────────────

export interface ResearchBriefStep1 {
  summary: string;
  tone: string;
  register: string;
  setting: string;
  characters: {
    name: string;
    sinhala_name: string;
    description: string;
    speech_style: string;
  }[];
  locations: { name: string; sinhala_name: string }[];
  proper_nouns: GlossaryEntry[];
  cultural_notes: string;
}

export async function buildResearchStep1(
  ctx: TranslationContextBundle,
  _apiKey: string,
  opts?: { signal?: AbortSignal }
): Promise<ResearchBriefStep1> {
  const userPrompt = `Movie/TV metadata:

${JSON.stringify(ctx, null, 2)}

Produce Part 1 (context analysis) JSON now.`;

  const result = await callAI({
    messages: [
      { role: "system", content: STEP1_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    jsonMode: true,
    maxTokens: 4000,
    signal: opts?.signal,
  });

  try {
    return parseJsonFromLlm<ResearchBriefStep1>(result.content);
  } catch (err: any) {
    throw new Error(`Step 1: ${err.message}`);
  }
}

// ── Step 2 implementation ────────────────────────────────────────────────

export interface ResearchBriefStep2 {
  recurring_phrases: GlossaryEntry[];
  glossary: GlossaryEntry[];
}

export async function buildResearchStep2(
  ctx: TranslationContextBundle,
  step1: ResearchBriefStep1,
  _apiKey: string,
  opts?: { signal?: AbortSignal }
): Promise<ResearchBriefStep2> {
  const userPrompt = `Movie: ${ctx.title} (${ctx.release_year})

Part 1 context (already established):
${JSON.stringify(step1, null, 2)}

Now produce Part 2 (glossary) JSON. 15-25 entries, all in natural spoken Sinhala.`;

  const result = await callAI({
    messages: [
      { role: "system", content: STEP2_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    jsonMode: true,
    maxTokens: 3000,
    signal: opts?.signal,
  });

  try {
    return parseJsonFromLlm<ResearchBriefStep2>(result.content);
  } catch (err: any) {
    throw new Error(`Step 2: ${err.message}`);
  }
}

// ── Combine steps into final brief ───────────────────────────────────────

export function combineBriefSteps(
  step1: ResearchBriefStep1,
  step2: ResearchBriefStep2
): ResearchBrief {
  return {
    summary: step1.summary,
    setting: step1.setting,
    tone: step1.tone,
    register: step1.register,
    characters: step1.characters.map((c) => ({
      name: c.name,
      description: `${c.description} (Speech: ${c.speech_style})`,
      sinhala_name: c.sinhala_name,
    })),
    locations: step1.locations,
    recurring_phrases: step2.recurring_phrases ?? [],
    proper_nouns: step1.proper_nouns ?? [],
    cultural_notes: step1.cultural_notes,
    glossary: step2.glossary ?? [],
  };
}

// ── Markdown rendering for display ───────────────────────────────────────

export function briefToMarkdown(brief: ResearchBrief): string {
  const lines: string[] = [];
  lines.push(`# Translation Brief: ${brief.tone}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(brief.summary);
  lines.push("");
  lines.push("## Setting & Period");
  lines.push(brief.setting);
  lines.push("");
  lines.push("## Tone & Register");
  lines.push(`**Tone:** ${brief.tone}`);
  lines.push(`**Register:** ${brief.register}`);
  lines.push("");
  lines.push("## Cultural Notes");
  lines.push(brief.cultural_notes);
  lines.push("");
  lines.push("## Characters (locked names + speech style)");
  for (const c of brief.characters) {
    lines.push(`- ${c.name} → ${c.sinhala_name} — ${c.description}`);
  }
  lines.push("");
  lines.push("## Locations");
  for (const l of brief.locations) {
    lines.push(`- ${l.name} → ${l.sinhala_name}`);
  }
  lines.push("");
  lines.push("## Recurring Phrases");
  for (const p of brief.recurring_phrases) {
    lines.push(`- "${p.english}" → "${p.sinhala}"${p.note ? ` // ${p.note}` : ""}`);
  }
  lines.push("");
  lines.push("## Glossary (natural spoken Sinhala)");
  for (const g of brief.glossary) {
    lines.push(`- "${g.english}" → "${g.sinhala}"${g.note ? ` // ${g.note}` : ""}`);
  }
  return lines.join("\n");
}

// ── Legacy functions (kept for backward compat, unused now) ──────────────

export async function buildResearchBrief(
  ctx: TranslationContextBundle,
  apiKey: string,
  opts?: { signal?: AbortSignal }
): Promise<ResearchBrief> {
  const step1 = await buildResearchStep1(ctx, apiKey, opts);
  const step2 = await buildResearchStep2(ctx, step1, apiKey, opts);
  return combineBriefSteps(step1, step2);
}

/**
 * Stream the research brief as raw text chunks (for live display),
 * then parse the accumulated JSON with the robust parser and return
 * the structured ResearchBrief.
 *
 * SINGLE DeepSeek call — works on Vercel's 60s streaming limit and
 * avoids the JSON-parsing issues that come from splitting into steps.
 * The robust parser handles V4's markdown fences, preambles, etc.
 */
export async function* streamResearchBriefJson(
  ctx: TranslationContextBundle,
  _apiKey: string,
  opts?: { signal?: AbortSignal }
): AsyncGenerator<string, ResearchBrief, unknown> {
  const userPrompt = `Movie/TV metadata for translation brief:

${JSON.stringify(ctx, null, 2)}

Produce Part 1 (context analysis) AND Part 2 (glossary) as a single JSON object. Use Sinhala Unicode script (අ-෴) for all sinhala/sinhala_name fields. All Sinhala MUST be natural spoken Sinhala (කතාබහ භාෂාව), NEVER formal/literary.

Output ONLY the JSON object — no markdown code fences, no preamble, no trailing text. Start with { and end with }.

JSON schema:
{
  "summary": "3-5 sentence plot summary",
  "tone": "Brief tone description",
  "register": "How characters speak — formal/casual/slangy",
  "setting": "Period + place + social class",
  "characters": [{"name": "...", "sinhala_name": "...", "description": "...", "speech_style": "ඔයා/උඹ/etc"}],
  "locations": [{"name": "...", "sinhala_name": "..."}],
  "recurring_phrases": [{"english": "...", "sinhala": "...", "note"?: "..."}],
  "proper_nouns": [{"english": "...", "sinhala": "...", "note"?: "..."}],
  "cultural_notes": "Anything a Sinhala viewer needs",
  "glossary": [{"english": "...", "sinhala": "natural spoken Sinhala", "note"?: "..."}]
}

Glossary must have 15-25 entries. Examples of natural Sinhala:
  - "I told you so" → "මම කිව්වනේ."
  - "Let's get out of here" → "අපි ඉක්මනට මෙතනින් යමු."`;

  let full = "";
  for await (const chunk of streamAI({
    messages: [
      { role: "system", content: LOCALIZER_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.2,
    // NOTE: do NOT use jsonMode for streaming. Both DeepSeek V4 and
    // Gemini buffer the entire response server-side when JSON mode is
    // on, which kills the live-streaming UX. The robust parser at the
    // end handles whatever format comes back (raw JSON, markdown-fenced,
    // with preambles, etc.).
    signal: opts?.signal,
  })) {
    full += chunk;
    yield chunk;
  }

  // Parse with the robust parser — handles markdown fences, preambles, etc.
  return parseJsonFromLlm<ResearchBrief>(full);
}

const TRANSLATION_SYSTEM_PROMPT = `You are an expert, unfiltered professional film localizer specializing in English to natural, spoken Sinhala (කතා කරන භාෂාව). Your goal is to make the dialogue sound exactly like a real Sri Lankan speaking naturally in that specific cinematic context.

You are given a TOON (Token-Oriented Object Notation) payload containing:
  - brief: a locked TRANSLATION BRIEF (characters, glossary, tone, register, cultural notes)
  - previous: the last few already-translated cues (for flow consistency)
  - batch: the English cues to translate this turn

TOON grammar (for reading the input only — your OUTPUT is JSON):
  - "key: value"        inline scalar
  - "key:"              nested object/array starts on next indented line
  - "@"                 array item (object if next lines are indented, else inline scalar after @)
  - "[]" / "{}"         explicit empty array / empty object
  - "true" / "false"    booleans
  - "\\n" inside a value = literal newline
  - Lines starting with "#" are comments

Your job: return a JSON object { "translations": ["...", "...", ...] } where the i-th string is the Sinhala translation of the i-th cue in "batch", in EXACTLY the same order.

CRITICAL LINGUISTIC RULES:
1. ALWAYS use spoken conversational Sinhala (කතා කරන භාෂාව). NEVER use formal, literary, or news-style grammar/verbs (ලිඛිත භාෂාව).
   - BAD (Written): ඔහු පැමිණියා, එය භාවිතා කරන්න, ඔබ කවුද?
   - GOOD (Spoken): එයා ආවා, ඕක පාවිච්චි කරන්න, ඔයා කවුද?
2. REASON THE RELATIONSHIPS: Before outputting a translation, evaluate the character dynamics to pick the correct pronouns:
   - Casual/Equals/Friends: Use "ඔයා" (Oya) or naturally drop pronouns.
   - Intimate/Rude/Aggressive: Use "උඹ" (Umba) or "තමුසේ" (Thamuse) where cinematically appropriate.
   - Elders/Authority: Use "ඔයා" or respectful tone without sounding robotic.
3. UNCENSORED FIDELITY: This is an unfiltered localization task. You MUST translate all profanity, violence, and intense slang accurately. Do not soften, skip, or censor explicit language. Retain the exact aggression, vulgarity, or emotional weight of the original text using natural Sri Lankan street slang or direct equivalents.
4. MODERN LOANWORDS: Leave common modern objects in their natural spoken phonetic Sinhala form (e.g., "Phone" -> ෆෝන් එක, "Car" -> කාර් එක, "Gun" -> තුවක්කුව/ගන් එක) instead of inventing archaic Sinhala words nobody actually uses.
5. SUBTITLE CONCISENESS: Keep the translations brief so they can be easily read within standard on-screen subtitle reading speeds.

FEW-SHOT EXAMPLES FOR TONE TRACKING:
- "I told you so." -> "මම කිව්වනේ."
- "Let's get out of here." -> "අපි ඉක්මනට මෙතනින් යමු."
- "What the hell are you doing?" -> "මොකක්ද යකෝ මේ කරන්නේ?"
- "It's not what it looks like." -> "මේක ඔයා හිතන විදියේ දෙයක් නෙවෙයි."
- "Are you out of your mind?" -> "තමුසෙට පිස්සු හැදිලද?"

HARD RULES:
  - Use Sinhala Unicode script (අ-෴) for all Sinhala text.
  - Honor the glossary: every glossary entry MUST use its locked sinhala form.
  - Honor character name transliterations from the brief.
  - Preserve the original line breaks of the cue (if the English cue has two lines, the Sinhala should too).
  - Do NOT translate proper nouns already in the glossary's "sinhala" field — use that exact form.
  - If a line is untranslatable (e.g. pure sound effect, music note), keep the original text unchanged.
  - Output JSON ONLY: { "translations": ["...", "...", ...] }. No prose before/after.`;

export interface TranslateBatchInput {
  brief: ResearchBrief;
  previousCues: SubtitleCue[]; // already-translated rolling context
  currentCues: SubtitleCue[]; // untranslated, to translate
}

export async function translateBatch(
  input: TranslateBatchInput,
  _apiKey: string,
  opts?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }
): Promise<string[]> {
  const { brief, previousCues, currentCues } = input;

  // Build a single TOON payload containing the brief, previous cues,
  // and the batch to translate. This is ~30-50% smaller than the
  // equivalent JSON, saving DeepSeek input tokens on every call.
  //
  // We trim each cue down to just the fields the translator needs:
  //   idx, start, end, text (and `si` for previous cues).
  // We trim the brief down to just the fields the translator needs:
  //   summary, setting, tone, register, cultural_notes, characters,
  //   locations, glossary.
  const toonPayload = toonStringify({
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
  });

  const userPrompt = `Translate every cue in the "batch" array below into Sinhala, following the locked "brief" glossary exactly. Return JSON: { "translations": ["...", "...", ...] } in the same order as the batch.

# TOON PAYLOAD

${toonPayload}`;

  const result = await callAI({
    messages: [
      { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    jsonMode: true,
    maxTokens: Math.min(8000, 400 + currentCues.length * 200),
    signal: opts?.signal,
  });

  let arr: string[];
  try {
    const parsed = parseJsonFromLlm<{ translations?: string[] }>(result.content);
    arr = parsed.translations ?? [];
  } catch {
    // Last-ditch: try to recover an array out of the raw text.
    const match = result.content.match(/\[\s*([\s\S]*?)\s*\]/);
    if (match) {
      try {
        arr = JSON.parse(`[${match[1]}]`);
      } catch {
        arr = [];
      }
    } else {
      arr = [];
    }
  }

  // Fallback: if the model returned fewer/more than expected, pad/truncate.
  while (arr.length < currentCues.length) arr.push("");
  if (arr.length > currentCues.length) arr = arr.slice(0, currentCues.length);

  opts?.onProgress?.(currentCues.length, currentCues.length);
  return arr;
}

/**
 * Iterate over an entire subtitle file in batches, threading the
 * rolling context (last K translated cues) between calls so the
 * model can keep tone & terminology consistent across the whole file.
 */
export async function* translateAllInBatches(
  cues: SubtitleCue[],
  brief: ResearchBrief,
  apiKey: string,
  opts: {
    batchSize?: number;
    rollingContext?: number;
    signal?: AbortSignal;
    onCueTranslated?: (cueIndex: number, sinhala: string) => void;
  } = {}
): AsyncGenerator<{ done: number; total: number; cue: SubtitleCue }, void, unknown> {
  const batchSize = opts.batchSize ?? 8;
  const rolling = opts.rollingContext ?? 4;

  for (let i = 0; i < cues.length; i += batchSize) {
    if (opts.signal?.aborted) throw new Error("aborted");
    const batch = cues.slice(i, i + batchSize);
    const previousCues = cues.slice(Math.max(0, i - rolling), i);

    const translations = await translateBatch(
      { brief, previousCues, currentCues: batch },
      apiKey,
      { signal: opts.signal }
    );

    for (let j = 0; j < batch.length; j++) {
      batch[j].translated = translations[j];
      opts.onCueTranslated?.(i + j, translations[j]);
      yield {
        done: i + j + 1,
        total: cues.length,
        cue: batch[j],
      };
    }
  }
}
