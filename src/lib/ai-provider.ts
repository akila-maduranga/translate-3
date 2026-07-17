/**
 * AI provider abstraction.
 *
 * Picks between DeepSeek and Gemini based on the `AI_PROVIDER` env var.
 * Default: "deepseek". Set `AI_PROVIDER="gemini"` to use Gemini 1.5 Flash.
 *
 * This abstraction normalises both providers to the same interface so
 * the rest of the app (research, translation, ai-search) doesn't need
 * to know which one is in use.
 *
 * Required env vars per provider:
 *   - deepseek: DEEPSEEK_API_KEY
 *   - gemini:   GEMINI_API_KEY
 *
 * Optional overrides:
 *   - DEEPSEEK_MODEL (default: "deepseek-v4-pro")
 *   - GEMINI_MODEL   (default: "gemini-3.5-flash")
 */

import {
  callDeepSeek,
  streamDeepSeek,
  DEFAULT_MODEL as DEEPSEEK_DEFAULT_MODEL,
} from "@/lib/deepseek";
import {
  callGemini,
  streamGemini,
  DEFAULT_GEMINI_MODEL,
} from "@/lib/gemini";

export type Provider = "deepseek" | "gemini";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the model to return JSON. Both providers support this. */
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
  return "deepseek";
}

/** Get the API key for the active provider. Throws if missing. */
export function getApiKey(): string {
  if (getProvider() === "gemini") {
    const key = process.env.GEMINI_API_KEY || "";
    if (!key) {
      throw new Error(
        "GEMINI_API_KEY is not configured. Set it as an env var, " +
          "or switch AI_PROVIDER back to 'deepseek'."
      );
    }
    return key;
  }
  const key = process.env.DEEPSEEK_API_KEY || "";
  if (!key) {
    throw new Error(
      "DEEPSEEK_API_KEY is not configured. Set it as an env var, " +
        "or switch AI_PROVIDER to 'gemini' and set GEMINI_API_KEY."
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
 * Synchronous call — normalises both providers to the same interface.
 *
 * DeepSeek uses OpenAI-style messages (system/user/assistant roles).
 * Gemini uses user/model roles + a separate systemInstruction field.
 * This function handles the conversion.
 */
export async function callAI(opts: CallOptions): Promise<CallResult> {
  const apiKey = getApiKey();
  const provider = getProvider();

  if (provider === "gemini") {
    // Extract system message — Gemini takes it as a separate field.
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
 * Streaming call — normalises both providers.
 *
 * NOTE: We do NOT use jsonMode for streaming. DeepSeek V4 buffers the
 * entire response when JSON mode is on (kills the live UX), and Gemini
 * has the same behaviour. The robust parser at the call site handles
 * whatever format comes back.
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
      // No responseMimeType — see comment above.
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
    // No responseFormat — see comment above.
    signal: opts.signal,
  });
}
