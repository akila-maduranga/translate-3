/**
 * SRT / VTT subtitle parser & serializer.
 *
 * Supports the two formats most subtitle tools produce:
 *   - SubRip (.srt)  — index, "HH:MM:SS,mmm --> HH:MM:SS,mmm", text
 *   - WebVTT (.vtt)  — optional header, "HH:MM:SS.mmm --> HH:MM:SS.mmm", text
 *
 * Returned cue objects are deliberately minimal so they can be JSON-
 * serialised through API boundaries and round-tripped losslessly.
 */

export interface SubtitleCue {
  index: number;
  start: number; // seconds, float
  end: number; // seconds, float
  startRaw: string;
  endRaw: string;
  text: string; // original (English) text, may contain \n
  translated?: string; // Sinhala text
}

export type SubtitleFormat = "srt" | "vtt";

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/** Format seconds → "HH:MM:SS,mmm" (SRT) or "HH:MM:SS.mmm" (VTT). */
export function formatTimestamp(seconds: number, format: SubtitleFormat): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const sep = format === "srt" ? "," : ".";
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(millis, 3)}`;
}

/** Parse "HH:MM:SS,mmm" or "HH:MM:SS.mmm" → seconds (float). */
export function parseTimestamp(raw: string): number {
  const m = raw.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  const [, h, mi, s, ms] = m;
  return (
    parseInt(h, 10) * 3600 +
    parseInt(mi, 10) * 60 +
    parseInt(s, 10) +
    parseInt(ms, 10) / 1000
  );
}

/** Detect format from filename extension. Default: srt. */
export function detectFormat(filename: string): SubtitleFormat {
  return filename.toLowerCase().endsWith(".vtt") ? "vtt" : "srt";
}

export function parseSubtitles(content: string, format: SubtitleFormat): SubtitleCue[] {
  // Normalise line endings, drop optional WEBVTT header.
  const text = content.replace(/\r\n?/g, "\n").trim();
  const body = format === "vtt" ? text.replace(/^WEBVTT[^\n]*\n+/, "") : text;

  // Split into blocks on blank lines.
  const blocks = body.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  let autoIndex = 0;

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    let idx = autoIndex + 1;
    let timeLineIdx = 0;

    // If first line is just a number, treat it as the SRT index.
    if (/^\d+$/.test(lines[0].trim())) {
      idx = parseInt(lines[0].trim(), 10);
      timeLineIdx = 1;
    }

    const timeLine = lines[timeLineIdx] ?? "";
    const timeMatch = timeLine.match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/
    );
    if (!timeMatch) continue;

    const startRaw = timeMatch[1];
    const endRaw = timeMatch[2];
    const textLines = lines.slice(timeLineIdx + 1);
    if (textLines.length === 0) continue;

    cues.push({
      index: idx,
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw),
      startRaw,
      endRaw,
      text: textLines.join("\n"),
    });
    autoIndex = idx;
  }

  return cues;
}

export function serializeSubtitles(cues: SubtitleCue[], format: SubtitleFormat): string {
  const out: string[] = [];
  if (format === "vtt") out.push("WEBVTT\n");

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (format === "srt") out.push(String(i + 1));
    out.push(
      `${formatTimestamp(cue.start, format)} --> ${formatTimestamp(cue.end, format)}`
    );
    out.push(cue.translated ?? cue.text);
    out.push("");
  }
  return out.join("\n");
}

/** Round-trip an uploaded file → cues → re-serialized (handy for sanity tests). */
export function normalizeSubtitles(
  content: string,
  format: SubtitleFormat
): { cues: SubtitleCue[]; serialized: string } {
  const cues = parseSubtitles(content, format);
  return { cues, serialized: serializeSubtitles(cues, format) };
}
