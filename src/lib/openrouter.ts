/**
 * OpenRouter API client.
 *
 * OpenRouter is an OpenAI-compatible gateway that routes requests to
 * many different models (Gemma, Llama, Mistral, Gemini, etc.) through
 * a single API. This makes it trivial to swap models without changing
 * code — just change the model name.
 *
 * Default model: google/gemma-4-26b-a4b-it:free (free tier)
 * Override with OPENROUTER_MODEL env var.
 *
 * API docs: https://openrouter.ai/docs
 * Model list: https://openrouter.ai/models
 *
 * Free tier models have ":free" suffix. They may have stricter rate
 * limits and slower response times than paid models, but cost nothing.
 *
 * The API is OpenAI-compatible — same request/response shape as
 * DeepSeek. So this client is structurally identical to deepseek.ts,
 * just with a different base URL and model default.
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** Default model — override with OPENROUTER_MODEL env var. */
export const DEFAULT_OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "google/gemma-4-26b-a4b-it:free";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterCallOptions {
  apiKey: string;
  model?: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
  signal?: AbortSignal;
}

export interface OpenRouterCallResult {
  content: string;
  finish_reason: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// OpenRouter recommends sending these headers for ranking/analytics.
// Optional but polite.
function extraHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": process.env.OPENROUTER_REFERER || "https://subsinhala.app",
    "X-Title": process.env.OPENROUTER_TITLE || "SubSinhala",
  };
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1500;

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
  return status === 429 || status === 503 || status === 502;
}

export async function callOpenRouter(
  opts: OpenRouterCallOptions
): Promise<OpenRouterCallResult> {
  if (!opts.apiKey) {
    throw new Error("OpenRouter API key is missing. Set OPENROUTER_API_KEY.");
  }

  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_OPENROUTER_MODEL,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    stream: false,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
          ...extraHeaders(),
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        if (shouldRetry(res.status) && attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          console.warn(
            `[openrouter] ${res.status} on attempt ${attempt + 1}, ` +
              `retrying in ${backoff}ms...`
          );
          await sleep(backoff, opts.signal);
          continue;
        }
        if (res.status === 429) {
          throw new Error(
            "OpenRouter rate limit hit (free tier). Wait a moment and try again, " +
              "or switch to a paid model."
          );
        }
        throw new Error(`OpenRouter ${res.status}: ${text}`);
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      if (!choice) {
        throw new Error("OpenRouter returned no choices.");
      }
      return {
        content: choice.message?.content ?? "",
        finish_reason: choice.finish_reason,
        usage: data.usage ?? {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
    } catch (err: any) {
      if (err.name === "AbortError") throw err;
      lastErr = err;
      if (attempt < MAX_RETRIES && !err.message.includes("rate limit")) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[openrouter] error on attempt ${attempt + 1}, ` +
            `retrying in ${backoff}ms: ${err.message}`
        );
        await sleep(backoff, opts.signal);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("OpenRouter call failed after retries.");
}

/**
 * Streamed OpenRouter call. Yields incremental text chunks.
 *
 * OpenRouter uses the same SSE format as OpenAI/DeepSeek:
 *   data: {"choices": [{"delta": {"content": "..."}}]}
 *   data: [DONE]
 */
export async function* streamOpenRouter(
  opts: OpenRouterCallOptions
): AsyncGenerator<string, void, unknown> {
  if (!opts.apiKey) {
    throw new Error("OpenRouter API key is missing.");
  }

  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_OPENROUTER_MODEL,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    stream: true,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  // NOTE: do NOT use responseFormat for streaming — causes buffering.
  // The robust parser at the call site handles whatever format comes back.

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
          ...extraHeaders(),
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        if (shouldRetry(res.status) && attempt < MAX_RETRIES) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          console.warn(
            `[openrouter stream] ${res.status} on attempt ${attempt + 1}, ` +
              `retrying in ${backoff}ms...`
          );
          await sleep(backoff, opts.signal);
          continue;
        }
        if (res.status === 429) {
          throw new Error(
            "OpenRouter rate limit hit (free tier). Wait a moment and try again."
          );
        }
        throw new Error(`OpenRouter ${res.status}: ${text}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              yield delta;
            }
          } catch {
            // ignore partial JSON
          }
        }
      }
      return;
    } catch (err: any) {
      if (err.name === "AbortError") throw err;
      lastErr = err;
      if (attempt < MAX_RETRIES && !err.message.includes("rate limit")) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `[openrouter stream] error on attempt ${attempt + 1}, ` +
            `retrying in ${backoff}ms: ${err.message}`
        );
        await sleep(backoff, opts.signal);
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("OpenRouter stream failed after retries.");
}
