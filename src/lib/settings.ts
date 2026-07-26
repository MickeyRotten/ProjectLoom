import type { Settings } from "../types";
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
    return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) };
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

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode etc.) — non-fatal.
  }
}
