import type { Settings } from "../types";
import type { ChatMessage } from "./prompt";

/**
 * OpenRouter streaming chat completion (OpenAI-compatible SSE). Direct fetch,
 * no SDK (DESIGN.md → AI). Yields text deltas via `onDelta` and resolves with
 * the full concatenated text. The caller truncates for display and parses the
 * <<<LOOM>>> block from the full text.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface StreamOptions {
  settings: Settings;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta: (fullText: string) => void;
}

export class OpenRouterError extends Error {}

export async function streamChat(opts: StreamOptions): Promise<string> {
  const { settings, messages, signal, onDelta } = opts;

  if (!settings.openRouterKey.trim()) {
    throw new OpenRouterError("No OpenRouter API key set. Add one in Settings.");
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openRouterKey.trim()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/MickeyRotten/ProjectLoom",
      "X-Title": "Project Loom",
    },
    body: JSON.stringify({
      model: settings.textModelId,
      temperature: settings.temperature,
      stream: true,
      messages,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await safeErrorText(res);
    throw new OpenRouterError(
      `OpenRouter ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by newlines; each `data:` line carries a chunk.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;

      const delta = extractDelta(payload);
      if (delta) {
        full += delta;
        onDelta(full);
      }
    }
  }

  return full;
}

function extractDelta(payload: string): string {
  try {
    const json = JSON.parse(payload);
    return json?.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return json?.error?.message ?? text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return "";
  }
}
