import type { ReasoningEffort, ReasoningLevel, Settings } from "../types";
import { defaultSettings } from "./defaults";

/**
 * Settings persist in localStorage (small, synchronous, survives reloads).
 * The API key lives here too — acceptable for a client-only on-device app.
 */
const SETTINGS_KEY = "loom.settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    // Merge over defaults so new fields added in later phases get sane values.
    const stored = JSON.parse(raw) as Partial<Settings>;
    return {
      ...defaultSettings(),
      ...stored,
      // `setupDone` arrived after first-run setup existed. Anyone already
      // holding a key has plainly been through it, and must not be handed a
      // setup screen for an app they have been playing.
      setupDone: stored.setupDone ?? Boolean(stored.openRouterKey?.trim()),
    };
  } catch {
    return defaultSettings();
  }
}

/**
 * Ceiling for the per-beat token cap. Generous — the cap exists to stop a
 * runaway beat, not to enforce a house style.
 */
export const MAX_BEAT_TOKENS = 8000;

/** Clamp a player-entered beat cap. 0 is meaningful: it sends no cap at all. */
export function clampMaxTokens(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_BEAT_TOKENS, Math.round(value));
}

/**
 * OpenRouter's unified `reasoning` request field — one shape across providers,
 * translated per-model on their side (an effort becomes a thinking budget for
 * models that want tokens instead of a level).
 */
export interface ReasoningParam {
  effort?: ReasoningEffort;
  /** `false` asks the provider to turn thinking off on a model that does it by default. */
  enabled?: boolean;
  /** Keep reasoning out of the response body. */
  exclude?: boolean;
}

/**
 * The `reasoning` field for a level, or `null` when the request must carry none.
 *
 * `auto` and any unrecognised stored value both omit it: a level that came out
 * of localStorage from a future (or corrupted) build must not be forwarded to
 * the API, where it would 400 every turn.
 *
 * `exclude: true` rides along with every effort level because nothing in the app
 * renders reasoning — the stream reads `delta.content` only — so shipping the
 * thinking text back would be bandwidth spent on something dropped on arrival.
 * It does not make the thinking free; reasoning tokens are still billed.
 */
export function reasoningParam(level: ReasoningLevel): ReasoningParam | null {
  switch (level) {
    case "off":
      return { enabled: false };
    case "minimal":
    case "low":
    case "medium":
    case "high":
      return { effort: level, exclude: true };
    default:
      return null;
  }
}

/** Spreadable request-body fragment — `{}` when the field must be omitted. */
export function reasoningBody(settings: Settings): { reasoning?: ReasoningParam } {
  const reasoning = reasoningParam(settings.reasoningLevel);
  return reasoning ? { reasoning } : {};
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode etc.) — non-fatal.
  }
}
