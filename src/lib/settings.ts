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

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode etc.) — non-fatal.
  }
}
