import type { Settings } from "../types";
import type { ChatMessage } from "./prompt";
import { MAX_ATTEMPTS, backoffMs, isRetryableStatus, sleep } from "./retry";

/**
 * OpenRouter streaming chat completion (OpenAI-compatible SSE). Direct fetch,
 * no SDK (DESIGN.md → AI). Yields text deltas via `onDelta` and resolves with
 * the full concatenated text. The caller truncates for display and parses the
 * <<<LOOM>>> block from the full text.
 *
 * Transient failures (network drop, rate-limit, gateway/overload) auto-retry
 * with exponential backoff (Phase 5, retry.ts). A retry restarts the whole
 * stream, so `onDelta` naturally re-emits from the top and the display resets.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";

export interface OpenRouterModel {
  id: string;
  name: string;
  /** Output modalities, e.g. ["text"] or ["image","text"]. Empty if unknown. */
  outputModalities: string[];
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Fetch the OpenRouter model catalog (public endpoint — no key required). Used
 * to populate the Model & Key dropdowns. Returns id/name/output-modalities,
 * sorted by id. Throws OpenRouterError on a non-OK response.
 */
export async function fetchModels(signal?: AbortSignal): Promise<OpenRouterModel[]> {
  const res = await fetch(MODELS_ENDPOINT, { signal });
  if (!res.ok) {
    throw new OpenRouterError(`OpenRouter ${res.status} ${res.statusText}`, {
      status: res.status,
    });
  }
  const json: unknown = await res.json();
  const data =
    json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)
      ? ((json as { data: unknown[] }).data)
      : [];

  const models: OpenRouterModel[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    const id = typeof m.id === "string" ? m.id : "";
    if (!id) continue;
    const arch = (m.architecture as Record<string, unknown> | undefined) ?? undefined;
    models.push({
      id,
      name: typeof m.name === "string" ? m.name : id,
      outputModalities: asStringArray(arch?.output_modalities),
    });
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

export interface StreamOptions {
  settings: Settings;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta: (fullText: string) => void;
}

export class OpenRouterError extends Error {
  /** HTTP status when the failure came from a response, else undefined. */
  status?: number;
  /** Whether re-issuing the same request could plausibly succeed. */
  retryable: boolean;
  constructor(message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "OpenRouterError";
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

export async function streamChat(opts: StreamOptions): Promise<string> {
  const { settings, signal, onDelta } = opts;

  if (!settings.openRouterKey.trim()) {
    throw new OpenRouterError("No OpenRouter API key set. Add one in Model & Key.");
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // Reset the display each attempt — a retried stream starts from scratch.
      onDelta("");
      return await streamOnce(opts);
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
      const retryable =
        err instanceof OpenRouterError ? err.retryable : err instanceof TypeError;
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw err;
      await sleep(backoffMs(attempt), signal);
    }
  }
  throw lastErr;
}

async function streamOnce(opts: StreamOptions): Promise<string> {
  const { settings, messages, signal, onDelta } = opts;

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
      { status: res.status, retryable: isRetryableStatus(res.status) },
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  try {
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

        const frame = parseFrame(payload);
        if (frame.error) {
          // OpenRouter reports upstream failures as an error frame mid-stream;
          // ignoring it would end the turn silently truncated (no block, no
          // options). Surface it like an HTTP failure so the retry loop runs.
          throw new OpenRouterError(`OpenRouter stream error — ${frame.error.message}`, {
            status: frame.error.code,
            retryable:
              frame.error.code === undefined || isRetryableStatus(frame.error.code),
          });
        }
        if (frame.delta) {
          full += frame.delta;
          onDelta(full);
        }
      }
    }
  } finally {
    // Stop the network stream on early exit (error frame / abort).
    void reader.cancel().catch(() => {});
  }

  return full;
}

interface Frame {
  delta: string;
  error?: { message: string; code?: number };
}

function parseFrame(payload: string): Frame {
  try {
    const json = JSON.parse(payload);
    const err = json?.error;
    if (err && typeof err === "object") {
      return {
        delta: "",
        error: {
          message:
            typeof err.message === "string" ? err.message : "Upstream error mid-stream.",
          code: typeof err.code === "number" ? err.code : undefined,
        },
      };
    }
    return { delta: json?.choices?.[0]?.delta?.content ?? "" };
  } catch {
    return { delta: "" };
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
