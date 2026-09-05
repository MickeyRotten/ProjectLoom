import type { Settings } from "../types";
import type { ChatMessage } from "./prompt";
import { MAX_ATTEMPTS, backoffMs, isRetryableStatus, sleep } from "./retry";
import { reasoningBody } from "./settings";
import { safeErrorText } from "./http";

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
const KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";

/** Where a player goes to make a key — linked from Setup and Narrator → Model. */
export const KEY_SIGNUP_URL = "https://openrouter.ai/keys";

export interface KeyStatus {
  /** The key's label, when OpenRouter reports one. */
  label: string;
  /** Remaining credit, when the key has a limit. `null` means no cap. */
  remaining: number | null;
}

/**
 * Check a key against OpenRouter's `/key` endpoint, which needs auth and so is
 * the only cheap way to tell a good key from a typo. `fetchModels` deliberately
 * cannot do this — the catalog is public, so it succeeds with any key at all,
 * and a wrong key otherwise stays invisible until the first turn fails.
 *
 * Throws `OpenRouterError` with the status; 401 is the "this key is wrong" case.
 */
export async function verifyKey(key: string, signal?: AbortSignal): Promise<KeyStatus> {
  const res = await fetch(KEY_ENDPOINT, {
    headers: { Authorization: `Bearer ${key.trim()}` },
    signal,
  });
  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new OpenRouterError(
      res.status === 401
        ? "That key was rejected by OpenRouter."
        : `OpenRouter ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
      { status: res.status },
    );
  }
  const json: unknown = await res.json();
  const data = (json as { data?: Record<string, unknown> } | null)?.data ?? {};
  const limit = typeof data.limit === "number" ? data.limit : null;
  const usage = typeof data.usage === "number" ? data.usage : 0;
  return {
    label: typeof data.label === "string" ? data.label : "",
    remaining: limit === null ? null : Math.max(0, limit - usage),
  };
}

export interface OpenRouterModel {
  id: string;
  name: string;
  /** Output modalities, e.g. ["text"] or ["image","text"]. Empty if unknown. */
  outputModalities: string[];
  /**
   * Nothing is billed for prompt OR completion tokens. Read off the catalog's
   * own pricing rather than the `:free` id suffix, because the suffix is a
   * naming convention some free models don't follow.
   */
  free: boolean;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Catalog prices are per-token decimal STRINGS ("0", "0.0000006"). Anything
 * unparseable is treated as priced — a model whose cost we can't read must not
 * be advertised as free.
 */
function priced(v: unknown): boolean {
  if (typeof v === "number") return v > 0;
  if (typeof v !== "string") return true;
  const n = Number(v);
  return Number.isFinite(n) ? n > 0 : true;
}

/**
 * Fetch the OpenRouter model catalog (public endpoint — no key required). Used
 * to populate the model dropdowns. Returns id/name/output-modalities,
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
    const pricing = (m.pricing as Record<string, unknown> | undefined) ?? undefined;
    models.push({
      id,
      name: typeof m.name === "string" ? m.name : id,
      outputModalities: asStringArray(arch?.output_modalities),
      free: !!pricing && !priced(pricing.prompt) && !priced(pricing.completion),
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
    throw new OpenRouterError("No OpenRouter API key set. Add one in Narrator → Model.");
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

export interface CompleteOptions {
  settings: Settings;
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** Sampling override — side calls (sheet updates) run tighter than narration. */
  temperature?: number;
  /**
   * Model override — authoring side calls (sheet/field/item/note/place
   * generation, Auto-Update) leave this unset and run on `settings.textModelId`,
   * since they write narrative content. The structured, narrow-question calls
   * — op verification (`verifyOps.ts`), travel-estimate refinement
   * (`travel.ts`), and block repair (`store.ts`, re-asking for the
   * `<<<LOOM>>>` shape a failed turn dropped) — pass `settings.cheapModelId`
   * instead: a strict-JSON-on-demand task is what a cheap instruct model is
   * good at, and asking the SAME model that just missed the shape risks the
   * same miss twice.
   */
  model?: string;
}

/**
 * One non-streamed chat completion, for side calls that want the whole answer
 * at once (character-sheet auto-update). Same key, headers, and retry policy as
 * the narration stream; returns the assistant text. Throws OpenRouterError.
 */
export async function completeChat(opts: CompleteOptions): Promise<string> {
  const { settings, signal } = opts;

  if (!settings.openRouterKey.trim()) {
    throw new OpenRouterError("No OpenRouter API key set. Add one in Narrator → Model.");
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await completeOnce(opts);
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

async function completeOnce(opts: CompleteOptions): Promise<string> {
  const { settings, messages, signal, temperature, model } = opts;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openRouterKey.trim()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/MickeyRotten/ProjectLoom",
      "X-Title": "Project Loom",
    },
    body: JSON.stringify({
      model: model ?? settings.textModelId,
      temperature: temperature ?? settings.temperature,
      stream: false,
      // Side calls run on the text model, so they answer to the same thinking
      // setting the narration does — one model, one behaviour.
      ...reasoningBody(settings),
      messages,
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await safeErrorText(res);
    throw new OpenRouterError(
      `OpenRouter ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
      { status: res.status, retryable: isRetryableStatus(res.status) },
    );
  }

  const json: unknown = await res.json();
  const text = extractMessageText(json);
  if (!text.trim()) {
    // A 200 with an empty message is a soft failure — worth another attempt.
    throw new OpenRouterError("OpenRouter returned an empty response.", { retryable: true });
  }
  return text;
}

/**
 * Assistant text from a completion response. Tolerates the two content shapes
 * in the wild: a plain string, or an array of `{ type: "text", text }` parts.
 */
export function extractMessageText(json: unknown): string {
  const choice = (json as { choices?: unknown[] } | null)?.choices?.[0] as
    | { message?: { content?: unknown } }
    | undefined;
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
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
      // Beats are meant to be short and punchy, but "short" was only ever a
      // sentence in the prompt — with no cap the model's own default decided,
      // and a chatty one both bills more and pushes the <<<LOOM>>> block past
      // where the player is still reading. 0 restores "no cap".
      ...(settings.maxTokens > 0 ? { max_tokens: settings.maxTokens } : {}),
      // Thinking effort (Narrator → Model → Reasoning). Absent on "auto", so a
      // request looks exactly as it did before the setting existed.
      ...reasoningBody(settings),
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

