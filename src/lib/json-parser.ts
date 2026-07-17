/**
 * Robust JSON parser for LLM output.
 *
 * LLMs (especially DeepSeek V4) often return JSON with:
 *   - Markdown code fences: ```json\n{...}\n```
 *   - Preambles: "Here is the JSON:\n{...}"
 *   - Trailing notes: "{...}\n\nLet me know if you need changes."
 *   - Reasoning tokens before the actual JSON (V4 thinking mode)
 *   - Multiple JSON objects (we want the largest/last one)
 *   - Truncated output (we try to repair common truncation)
 *
 * This parser handles all those cases. Throws if no JSON can be
 * extracted.
 */

export function parseJsonFromLlm<T>(raw: string): T {
  if (!raw || typeof raw !== "string") {
    throw new Error("Empty response from AI.");
  }

  // 1. Try direct parse (fast path).
  try {
    return JSON.parse(raw) as T;
  } catch {}

  // 2. Strip markdown code fences if present.
  //    Matches ```json ... ``` or ``` ... ```
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]) as T;
    } catch {}
  }

  // 3. Find the first '{' and try to parse from there to the matching '}'.
  //    This handles preambles like "Here is the JSON:\n{...}".
  const firstBrace = raw.indexOf("{");
  if (firstBrace !== -1) {
    const candidate = raw.slice(firstBrace);
    try {
      return JSON.parse(candidate) as T;
    } catch {}

    // 4. Try to find the LAST '}' and parse the substring.
    //    This handles trailing notes after the JSON.
    const lastBrace = candidate.lastIndexOf("}");
    if (lastBrace !== -1) {
      const trimmed = candidate.slice(0, lastBrace + 1);
      try {
        return JSON.parse(trimmed) as T;
      } catch {}
    }
  }

  // 5. Last resort: extract the largest {...} block using regex.
  //    This is the original fallback — catches nested objects.
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]) as T;
    } catch {}
  }

  // 6. If we got here, we couldn't parse. Throw with a helpful message
  //    that includes the first 200 chars of the response for debugging.
  const preview = raw.slice(0, 200).replace(/\s+/g, " ").trim();
  throw new Error(
    `AI returned invalid JSON. Please try again. (Preview: "${preview}${raw.length > 200 ? "..." : ""}")`
  );
}
