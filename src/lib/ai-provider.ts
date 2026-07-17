/**
 * AI provider abstraction.
 *
 * Picks between DeepSeek, Gemini, and OpenRouter based on the
 * `AI_PROVIDER` env var. Default: "deepseek".
 *
 *   - "deepseek"   → DEEPSEEK_API_KEY (pay-per-use, fast)
 *   - "gemini"     → GEMINI_API_KEY (free tier, 15 RPM)
 *   - "openrouter" → OPENROUTER_API_KEY (free tier, many models)
 *
 * OpenRouter is the most flexible — it's an OpenAI-compatible gateway
 * to 100+ models. Set OPENROUTER_MODEL to swap models without code
 * changes (e.g. "google/gemma-4-26b-a4b-it:free",
 * "meta-llama/llama-3.3-70b-instruct:free", etc.)
 *
 * Required env vars per provider:
 *   - deepseek:   DEEPSEEK_API_KEY
 *   - gemini:     GEMINI_API_KEY
 *   - openrouter: OPENROUTER_API_KEY
 *
 * Optional overrides:
 *   - DEEPSEEK_MODEL   (default: "deepseek-v4-pro")
 *   - GEMINI_MODEL     (default: "gemini-3.5-flash")
 *   - OPENROUTER_MODEL (default: "google/gemma-4-26b-a4b-it:free")
 */

import {
  callDeepSeek,
  streamDeepSeek,
  DEFAULT_MODEL as DEEPSEEK_DEFAULT_MODEL,
} from "@/lib/deepseek";
import {
  callGemini,
  streamGemini,
} from "@/lib/gemini";
import {
  callOpenRouter,
  streamOpenRouter,
  DEFAULT_OPENROUTER_MODEL,
} from "@/lib/openrouter";

export type Provider = "deepseek" | "gemini" | "openrouter";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the model to return JSON. All providers support this. */
  jsonMode?: boolean;
  signal?: AbortSignal;
}

export interface CallResult {
  content: string;
  finish_reason: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Which provider are we using? */
export function getProvider(): Provider {
  const p = (process.env.AI_PROVIDER || "deepseek").toLowerCase().trim();
  if (p === "gemini") return "gemini";
  if (p === "openrouter") return "openrouter";
  return "deepseek";
}

/** Get the API key for the active provider. Throws if missing. */
export function getApiKey(): string {
  const provider = getProvider();
  if (provider === "gemini") {
    const key = process.env.GEMINI_API_KEY || "";
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is not configured. Set it as an env var, " +
          "or switch AI_PROVIDER to 'deepseek' or 'openrouter'."
      );
    }
    return key;
  }
  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY || "";
    if (!key) {
      throw new Error(
        "OPENROUTER_API_KEY is not configured. Set it as an env var, " +
          "or switch AI_PROVIDER to 'deepseek' or 'gemini'."
      );
    }
    return key;
  }
  // deepseek
  const key = process.env.DEEPSEEK_API_KEY || "";
  if (!key) {
    throw new Error(
      "DEEPSEEK_API_KEY is not configured. Set it as an env var, " +
        "or switch AI_PROVIDER to 'gemini' or 'openrouter'."
    );
  }
  return key;
}

/** Check if the active provider is configured (without throwing). */
export function isProviderConfigured(): boolean {
  try {
    getApiKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronous call — normalises all providers to the same interface.
 *
 * DeepSeek + OpenRouter are OpenAI-compatible (system/user/assistant roles).
 * Gemini uses user/model roles + a separate systemInstruction field.
 * This function handles the conversion.
 */
export async function callAI(opts: CallOptions): Promise<CallResult> {
  const apiKey = getApiKey();
  const provider = getProvider();

  if (provider === "gemini") {
    const systemMsg = opts.messages.find((m) => m.role === "system");
    const conversationMessages = opts.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
        content: m.content,
      }));

    const result = await callGemini({
      apiKey,
      systemInstruction: systemMsg?.content,
      messages: conversationMessages,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      responseMimeType: opts.jsonMode ? "application/json" : "text/plain",
      signal: opts.signal,
    });
    return result;
  }

  if (provider === "openrouter") {
    const result = await callOpenRouter({
      apiKey,
      model: DEFAULT_OPENROUTER_MODEL,
      messages: opts.messages,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      responseFormat: opts.jsonMode ? "json_object" : undefined,
      signal: opts.signal,
    });
    return result;
  }

  // DeepSeek — OpenAI-compatible, passes through directly.
  const result = await callDeepSeek({
    apiKey,
    model: DEEPSEEK_DEFAULT_MODEL,
    messages: opts.messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    responseFormat: opts.jsonMode ? "json_object" : undefined,
    signal: opts.signal,
  });
  return result;
}

/**
 * Streaming call — normalises all providers.
 *
 * NOTE: We do NOT use jsonMode for streaming. All three providers
 * buffer the entire response server-side when JSON mode is on, which
 * kills the live-streaming UX. The robust parser at the call site
 * handles whatever format comes back.
 */
export async function* streamAI(
  opts: CallOptions
): AsyncGenerator<string, void, unknown> {
  const apiKey = getApiKey();
  const provider = getProvider();

  if (provider === "gemini") {
    const systemMsg = opts.messages.find((m) => m.role === "system");
    const conversationMessages = opts.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
        content: m.content,
      }));

    yield* streamGemini({
      apiKey,
      systemInstruction: systemMsg?.content,
      messages: conversationMessages,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    });
    return;
  }

  if (provider === "openrouter") {
    yield* streamOpenRouter({
      apiKey,
      model: DEFAULT_OPENROUTER_MODEL,
      messages: opts.messages,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
    });
    return;
  }

  yield* streamDeepSeek({
    apiKey,
    model: DEEPSEEK_DEFAULT_MODEL,
    messages: opts.messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    signal: opts.signal,
  });
}
