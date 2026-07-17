/**
 * Google Gemini API client.
 *
 * Gemini 3.5 Flash is free tier with limits:
 *   - 15 RPM (requests per minute)
 *   - 1,500 RPD (requests per day)
 *   - 1,000,000 TPM (tokens per minute)
 *
 * This client includes automatic retry with exponential backoff for
 * 429 (rate limit) and 503 (overloaded) responses — important because
 * the free tier's 15 RPM limit is easy to hit during a translation
 * job (each batch = 1 request, plus research = 1-2 requests).
 *
 * API docs: https://ai.google.dev/gemini-api/docs
 *
 * The API is NOT OpenAI-compatible — different request/response shape.
 * This client normalises to the same interface as our DeepSeek client
 * so the rest of the app doesn't care which provider is in use.
 */

const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiMessage {
  role: "user" | "model";
  content: string;
}

export interface GeminiCallOptions {
  apiKey: string;
  model?: string;
  systemInstruction?: string;
  messages: GeminiMessage[];
  temperature?: number;
  maxTokens?: number;
  responseMimeType?: "application/json" | "text/plain";
  signal?: AbortSignal;
}

export interface GeminiCallResult {
  content: string;
  finish_reason: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Default model — override with GEMINI_MODEL env var. */
export const DEFAULT_GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.5-flash";

const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 1500; // be conservative — free tier is strict

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      });
    }
  });
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 503 || status === 500;
}

export async function callGemini(
  opts: GeminiCallOptions
): Promise<GeminiCallResult> {
  if (!opts.apiKey) {
    throw new Error("Gemini API key is missing. Set GEMINI_API_KEY.");
  }

  const model = opts.model ?? DEFAULT_GEMINI_MODEL;
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${opts.apiKey}`;

  const body: Record<string, unknown> = {
    contents: opts.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxTokens ?? 8192,
      ...(opts.responseMimeType
        ? { responseMimeType: opts.responseMimeType }
        : {}),
    },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: opts.systemInstruction }],
    };
  }

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        // Retry on rate-limit / overload.
        if (shouldRetry(res.status) && attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          console.warn(
            `[gemini] ${res.status} on attempt ${attempt + 1}, ` +
              `retrying in ${backoff}ms...`
          );
          await sleep(backoff, opts.signal);
          continue;
        }
        // Build a helpful error message for common cases.
        if (res.status === 429) {
          throw new Error(
            "Gemini free-tier rate limit hit (15 RPM / 1500 RPD). " +
              "Wait 60 seconds and try again, or upgrade to a paid tier."
          );
        }
        if (res.status === 400) {
          throw new Error(
            `Gemini 400 Bad Request: ${text.slice(0, 300)}`
          );
        }
        throw new Error(`Gemini ${res.status}: ${text}`);
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      if (!candidate) {
        // Sometimes Gemini returns no candidates when safety filters trigger.
        const blocked = data.promptFeedback?.blockReason;
        if (blocked) {
          throw new Error(
            `Gemini blocked the request: ${blocked}. Try rephrasing the input.`
          );
        }
        throw new Error("Gemini returned no candidates.");
      }
      const content =
        candidate.content?.parts?.map((p: any) => p.text).join("") ?? "";
      return {
        content,
        finish_reason: candidate.finishReason ?? "STOP",
        usage: {
          prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
          completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
          total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
        },
      };
    } catch (err: any) {
      if (err.name === "AbortError") throw err;
      lastErr = err;
      // Network errors — retry with backoff.
      if (attempt < MAX_RETRIES && !err.message.includes("rate limit")) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[gemini] network error on attempt ${attempt + 1}, ` +
            `retrying in ${backoff}ms: ${err.message}`
        );
        await sleep(backoff, opts.signal);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Gemini call failed after retries.");
}

/**
 * Streamed Gemini call. Yields incremental text chunks as they arrive.
 *
 * Gemini's streaming endpoint is `streamGenerateContent?alt=sse` which
 * returns Server-Sent Events. Each event is a partial candidate with
 * a `text` part.
 *
 * Includes the same retry logic as callGemini.
 */
export async function* streamGemini(
  opts: GeminiCallOptions
): AsyncGenerator<string, void, unknown> {
  if (!opts.apiKey) {
    throw new Error("Gemini API key is missing.");
  }

  const model = opts.model ?? DEFAULT_GEMINI_MODEL;
  const url = `${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse&key=${opts.apiKey}`;

  const body: Record<string, unknown> = {
    contents: opts.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxTokens ?? 8192,
      ...(opts.responseMimeType
        ? { responseMimeType: opts.responseMimeType }
        : {}),
    },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: opts.systemInstruction }],
    };
  }

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        if (shouldRetry(res.status) && attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          console.warn(
            `[gemini stream] ${res.status} on attempt ${attempt + 1}, ` +
              `retrying in ${backoff}ms...`
          );
          await sleep(backoff, opts.signal);
          continue;
        }
        if (res.status === 429) {
          throw new Error(
            "Gemini free-tier rate limit hit (15 RPM / 1500 RPD). " +
              "Wait 60 seconds and try again."
          );
        }
        throw new Error(`Gemini ${res.status}: ${text}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by blank lines.
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          // Each event starts with "data: " followed by JSON.
          const dataLine = evt
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const jsonStr = dataLine.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const json = JSON.parse(jsonStr);
            const parts = json.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              for (const p of parts) {
                if (typeof p.text === "string" && p.text.length > 0) {
                  yield p.text;
                }
              }
            }
          } catch {
            // ignore partial JSON
          }
        }
      }
      return; // success — exit the retry loop
    } catch (err: any) {
      if (err.name === "AbortError") throw err;
      lastErr = err;
      if (attempt < MAX_RETRIES && !err.message.includes("rate limit")) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[gemini stream] network error on attempt ${attempt + 1}, ` +
            `retrying in ${backoff}ms: ${err.message}`
        );
        await sleep(backoff, opts.signal);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Gemini stream failed after retries.");
}
