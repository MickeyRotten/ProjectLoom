import { FONT_CHOICES } from "../types";
import type {
  FontChoice,
  QuickAction,
  ReasoningEffort,
  ReasoningLevel,
  Settings,
  WebFont,
} from "../types";
import {
  DEFAULT_INK,
  DEFAULT_JOURNAL_BUDGET,
  DEFAULT_JOURNAL_MAX_TURNS,
  DEFAULT_JOURNAL_MIN_TURNS,
  DEFAULT_PAPER,
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_TEXT_SIZE,
  defaultSettings,
} from "./defaults";

/**
 * Fields that existed in an earlier shape of the stored settings and no longer
 * exist on `Settings`. They are read once, on load, to carry a player's choice
 * across the rename — see the migrations in `loadSettings`.
 */
interface LegacySettings {
  /** Pre-`paper`/`ink`: a boolean flip of the two 1-bit tokens. */
  invert?: boolean;
  /** Pre-`textSize`: a four-step scale that resolved to Tailwind classes. */
  textScale?: "s" | "m" | "l" | "xl";
}

/** The pixel size each old `textScale` step actually rendered at. */
const LEGACY_SCALE_PX: Record<NonNullable<LegacySettings["textScale"]>, number> = {
  s: 14,
  m: 16,
  l: 18,
  xl: 20,
};

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
    const stored = JSON.parse(raw) as Partial<Settings> & LegacySettings;
    return {
      ...defaultSettings(),
      ...stored,
      // `setupDone` arrived after first-run setup existed. Anyone already
      // holding a key has plainly been through it, and must not be handed a
      // setup screen for an app they have been playing.
      setupDone: stored.setupDone ?? Boolean(stored.openRouterKey?.trim()),
      // Spreading `stored` would hand the composer whatever shape localStorage
      // happens to hold — an array of two, of objects with no `input`, of
      // nulls. Normalized at READ time, like `normalizeDice`, so the editor and
      // the composer can both assume three well-formed rows.
      quickActions: normalizeQuickActions(stored.quickActions),
      // Same discipline for the journal's numbers: sanitized at READ, so the
      // screen can edit one field without having to rewrite the next, and a
      // stored 0 for the gap can never make every turn a boundary.
      journalBudget: clampJournalBudget(stored.journalBudget ?? DEFAULT_JOURNAL_BUDGET),
      journalMaxTurns: clampJournalMaxTurns(
        stored.journalMaxTurns ?? DEFAULT_JOURNAL_MAX_TURNS,
      ),
      journalMinTurns: clampJournalMinTurns(
        stored.journalMinTurns ?? DEFAULT_JOURNAL_MIN_TURNS,
      ),
      // Colors, sanitized at READ so a corrupted hex can never leave the app
      // drawn in a color nobody can read — including the Appearance screen that
      // would be the only way back. A save written before the pickers existed
      // carries `invert`, which is exactly one point in the new space.
      paper: normalizeHex(stored.paper, stored.invert ? "#000000" : DEFAULT_PAPER),
      ink: normalizeHex(stored.ink, stored.invert ? "#ffffff" : DEFAULT_INK),
      // Same discipline for the reading size. The legacy four-step scale maps to
      // the pixel values its Tailwind classes already resolved to, so nobody's
      // setting moves on upgrade.
      textSize: clampTextSize(
        stored.textSize ??
          (stored.textScale ? LEGACY_SCALE_PX[stored.textScale] : DEFAULT_TEXT_SIZE),
      ),
      webFonts: normalizeWebFonts(stored.webFonts),
    };
  } catch {
    return defaultSettings();
  }
}

/**
 * Fold anything stored under `quickActions` onto exactly one row per shipped
 * shortcut. A missing entry (every save written before the row was editable)
 * takes the default; a present one is kept as the player wrote it, INCLUDING
 * blank — a blank label or input is how a shortcut is removed, so falling back
 * to the default there would make the third button undeletable.
 */
export function normalizeQuickActions(stored: unknown): QuickAction[] {
  const list = Array.isArray(stored) ? stored : [];
  return DEFAULT_QUICK_ACTIONS.map((fallback, i) => {
    const raw = list[i];
    if (!raw || typeof raw !== "object") return { ...fallback };
    const { label, input } = raw as Partial<QuickAction>;
    return {
      label: typeof label === "string" ? label.trim() : fallback.label,
      input: typeof input === "string" ? input.trim() : fallback.input,
    };
  });
}

/** The shortcuts that actually render — both halves written in. */
export function usableQuickActions(actions: QuickAction[]): QuickAction[] {
  return actions.filter((a) => a.label.trim() && a.input.trim());
}

/** Picker copy for each bundled font — label plus what it actually looks like. */
export const FONT_LABELS: Record<FontChoice, { label: string; note: string }> = {
  system: { label: "System Mono", note: "The device's monospace — widest glyph coverage." },
  vt323: { label: "VT323", note: "Monospaced CRT terminal face." },
  jersey15: { label: "Jersey 15", note: "Blocky pixel display face, not monospaced." },
};

/**
 * Fold anything stored under `webFonts` onto well-formed rows. Both halves must
 * be non-empty strings — an `id` is a `data-font` value and an IndexedDB key
 * prefix, and a blank one would point the app at a rule that cannot exist.
 * Duplicate ids collapse to the first, so a double Add cannot produce two rows
 * fighting over one CSS selector.
 */
export function normalizeWebFonts(stored: unknown): WebFont[] {
  const list = Array.isArray(stored) ? stored : [];
  const seen = new Set<string>();
  const out: WebFont[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const { family, id } = raw as Partial<WebFont>;
    if (typeof family !== "string" || typeof id !== "string") continue;
    const trimmed = family.trim();
    if (!trimmed || !id.trim() || seen.has(id)) continue;
    seen.add(id);
    const ranges = (raw as Partial<WebFont>).ranges;
    out.push({
      family: trimmed,
      id,
      ranges: Array.isArray(ranges) ? ranges.map((r) => (typeof r === "string" ? r : "")) : [],
    });
  }
  return out;
}

/**
 * The `data-font` value for a stored setting — the hook `theme.css` (bundled
 * faces) and `webFonts.ts`'s injected stylesheet (added ones) hang the
 * `--font-mono` override on.
 *
 * Anything unrecognised falls back to `system`, so a value written by a future
 * (or corrupted) build — or an added font the player has since removed —
 * degrades to the platform stack instead of leaving the app with a
 * `--font-mono` no `@font-face` defines.
 */
export function fontTheme(font: string | undefined, webFonts: WebFont[] = []): string {
  if (!font) return "system";
  if ((FONT_CHOICES as readonly string[]).includes(font)) return font;
  return webFonts.some((f) => f.id === font) ? font : "system";
}

/* ------------------------------------------------------------------ *
 * Reading size (Settings → Appearance). Pixels rather than a four-step scale,
 * because an added Google font carries no `size-adjust` and so renders at
 * whatever size its designer drew — the player needs a control fine enough to
 * answer that, which S/M/L/XL was not.
 * ------------------------------------------------------------------ */

/**
 * Bounds for the narration size. The floor is where prose stops being prose on
 * a phone; the ceiling is roughly two words a line, past which nothing is
 * gained. Both are generous — this is a reading preference, not a house style.
 */
export const MIN_TEXT_SIZE = 10;
export const MAX_TEXT_SIZE = 40;

/** What one press of −/+ moves the size by. */
export const TEXT_SIZE_STEP = 2;

/** Clamp a stored or stepped reading size to something renderable. */
export function clampTextSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEXT_SIZE;
  return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(value)));
}

/* ------------------------------------------------------------------ *
 * Colors. Two of them: `--paper` behind everything and `--ink` for every glyph,
 * border and fill. `--scrim`, `color-scheme` and the browser chrome color are
 * all DERIVED from that pair (`App.tsx`) rather than being settings of their
 * own, so there is exactly one place a color is chosen.
 * ------------------------------------------------------------------ */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Normalize a stored color to `#rrggbb`, or fall back.
 *
 * Accepts the short form and any case, because these values also come straight
 * off an `<input type="color">` and out of hand-edited storage. Anything else
 * takes the fallback: an unreadable color would hide the Appearance screen
 * itself, which is the only way to fix it.
 */
export function normalizeHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const m = HEX_RE.exec(value.trim());
  if (!m) return fallback;
  const body = m[1].toLowerCase();
  return body.length === 3
    ? `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
    : `#${body}`;
}

/** The three channels of a normalized `#rrggbb`, 0–255. */
function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * WCAG relative luminance, 0 (black) to 1 (white). Used only to decide which
 * way round the app currently reads — see `isDarkPaper`.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whether the chosen paper reads as a dark theme. Drives `color-scheme`, which
 * is how a dark-OS WebView is told we own theming and must not run its own
 * force-dark pass over the generated 1-bit bitmaps.
 */
export function isDarkPaper(paper: string): boolean {
  return relativeLuminance(paper) < 0.5;
}

/**
 * The dice-toss backdrop (`--scrim`): ink at 60%. It has always been derived
 * from the ink token rather than being a color of its own, so that the beat
 * behind the dice stays legible whichever way round the app is drawn.
 */
export function scrimFrom(ink: string): string {
  const [r, g, b] = channels(ink);
  return `rgb(${r} ${g} ${b} / 0.6)`;
}

/** One-tap color pairs, including the two the old Invert toggle switched between. */
export interface ColorPreset {
  id: string;
  label: string;
  paper: string;
  ink: string;
}

export const COLOR_PRESETS: ColorPreset[] = [
  { id: "paper", label: "Ink on Paper", paper: "#ffffff", ink: "#000000" },
  { id: "ink", label: "Paper on Ink", paper: "#000000", ink: "#ffffff" },
  { id: "amber", label: "Amber CRT", paper: "#0d0700", ink: "#ffb000" },
  { id: "green", label: "Green CRT", paper: "#001100", ink: "#33ff33" },
];

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
 * Ceiling for the injected journal. Deliberately well under the history budget
 * — the journal's job is continuity over the recent stretch, not permanent
 * recall, and everything durable should already be a World Note.
 */
export const MAX_JOURNAL_BUDGET = 8000;

/** Bounds for the journal's turn triggers. */
export const MIN_JOURNAL_TURNS = 1;
export const MAX_JOURNAL_TURNS = 200;

/** Clamp the journal's token budget. 0 is meaningful: it injects nothing. */
export function clampJournalBudget(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_JOURNAL_BUDGET, Math.round(value));
}

function clampTurns(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_JOURNAL_TURNS, Math.max(MIN_JOURNAL_TURNS, Math.round(value)));
}

export function clampJournalMaxTurns(value: number): number {
  return clampTurns(value, DEFAULT_JOURNAL_MAX_TURNS);
}

export function clampJournalMinTurns(value: number): number {
  return clampTurns(value, DEFAULT_JOURNAL_MIN_TURNS);
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
