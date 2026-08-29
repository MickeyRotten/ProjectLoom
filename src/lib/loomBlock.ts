import type { LoomBlock, Settings } from "../types";
import { writesBlock } from "./features";

/**
 * The <<<LOOM>>> turn contract — parsing + streaming truncation.
 * See .claude/skills/loom-turn-protocol/SKILL.md (read before editing).
 *
 * Invariants enforced here:
 *  - Streaming display truncates at the first `<<<` so JSON never flashes.
 *  - Parse is tolerant: brace-matched salvage, and the block is ALWAYS stripped
 *    from displayed prose even when the JSON is malformed (bad JSON must never
 *    leak into chat).
 *
 * "Tolerant" is doing more work than it used to, because weak models fail the
 * contract in four distinct ways and only one of them used to survive:
 *
 *  A. no block at all — nothing to do here (see `needsBlockRepair`);
 *  B. a block whose marker is mangled or missing — `findBlock` matches marker
 *     VARIANTS and, failing that, the last brace-balanced object in the tail.
 *     That second path also closes a leak: with no `<<<` anywhere in the
 *     response, nothing used to cut the prose, so the raw JSON was rendered
 *     into the reading pane as narration;
 *  C. options written as a numbered list in the prose instead of the block —
 *     `extractProseOptions` lifts them out and strips them from the prose;
 *  D. an `options` field of the wrong shape — `normalizeOptions` coerces every
 *     shape seen in the wild down to `string[]`, which is what the type has
 *     always claimed and nothing ever checked.
 *
 * What is emitted is unchanged: `LOOM_OPEN` is still the one canonical marker,
 * and the prompt still asks for exactly it. All of this is READ-side leniency.
 */

export const LOOM_OPEN = "<<<LOOM>>>";

/**
 * What the user sees while a response streams in: everything up to the first
 * `<<<`. Port of Wayward's StreamingWindow trick. Also hides a trailing partial
 * marker (1–2 `<` at the very end) so the `<<<` never flashes char-by-char as
 * it arrives.
 *
 * Deliberately NOT marker-tolerant and deliberately not brace-aware: it runs on
 * every delta, and mid-stream there is no balanced object to find anyway. The
 * tolerant paths all live in `parseLoomResponse`, which runs once per turn.
 */
export function truncateForDisplay(streamingText: string): string {
  const i = streamingText.indexOf("<<<");
  if (i !== -1) return streamingText.slice(0, i).trimEnd();
  return streamingText.replace(/<{1,2}$/, "").trimEnd();
}

export interface ParsedResponse {
  /** Display prose, block stripped, always safe to render. */
  prose: string;
  /** Parsed block, or null if absent/unsalvageable. */
  block: LoomBlock | null;
}

/**
 * Parse a completed narrator response into display prose + the optional block.
 * Prose is taken as everything before the block, regardless of whether the JSON
 * parses — so malformed blocks never leak.
 */
export function parseLoomResponse(raw: string): ParsedResponse {
  const found = findBlock(raw);
  let prose = found ? stripTrailingFence(raw.slice(0, found.cutAt)) : truncateForDisplay(raw);

  const parsed = found?.parsed ?? null;
  const read = readOptions(parsed);
  let options = read.options;

  // Only when the block gave us nothing: a numbered list in the prose is the
  // model's second-favourite place to put the options, and leaving it there
  // costs the player their buttons AND puts a list in the middle of a story.
  if (!options.length) {
    const salvaged = extractProseOptions(prose);
    if (salvaged) {
      options = salvaged.options;
      prose = salvaged.prose;
    }
  }

  if (!parsed) {
    // No machine block at all. Options lifted out of the prose still have to
    // reach the UI, and a block is the only channel there is.
    return { prose, block: options.length ? { options } : null };
  }

  // Drop whatever the model called the field and write back the normalized
  // array, so every reader downstream — the store, `Message.appliedDeltas`, the
  // reversal restore — gets a real `string[]`.
  const block = parsed as LoomBlock & Record<string, unknown>;
  for (const alias of OPTION_ALIASES) delete block[alias];
  if (options.length || read.hadKey) block.options = options;
  return { prose, block };
}

/** Where a machine block was found in a response, and what it parsed to. */
interface FoundBlock {
  /** Index in the raw response where the block starts — prose ends here. */
  cutAt: number;
  /** The parsed object, or null when the JSON was unsalvageable. */
  parsed: Record<string, unknown> | null;
}

/**
 * Marker variants accepted on read: `<<<LOOM>>>` (canonical), `<<LOOM>>`,
 * `<LOOM>`, `[LOOM]`, `<<< LOOM >>>`, `<<<loom>>>`, any of them with a trailing
 * colon, and the opening half alone.
 */
const MARKER_RE = /(?:<{1,3}|\[)\s*loom\s*(?:>{1,3}|\])?\s*:?/gi;

/** A marker only counts if an object actually follows it (fence allowed). */
const AFTER_MARKER = /^\s*(?:```(?:json)?\s*)?\{/;

/** How far past a marker to look for the opening brace. */
const MARKER_LOOKAHEAD = 24;

/**
 * The response's machine block. Two paths, in order of trust: a marker with an
 * object after it, then — for a model that dropped the marker entirely — the
 * last brace-balanced object in the response.
 */
function findBlock(raw: string): FoundBlock | null {
  const marker = markerAt(raw);
  if (marker) {
    const json = extractFirstJsonObject(raw.slice(marker.end));
    return {
      cutAt: marker.index,
      parsed: json ? parseJsonTolerant<Record<string, unknown>>(json) : null,
    };
  }

  // No marker of any kind. A model that emitted the object anyway — fenced, or
  // bare after the prose — must not have it rendered as narration.
  const tail = extractLastJsonObject(raw);
  if (!tail) return null;
  const parsed = parseJsonTolerant<Record<string, unknown>>(tail.json);
  // The guard that makes this safe: prose contains braces (`{curly}`), and a
  // stray one must stay prose. Only an object carrying at least one field of
  // the contract is treated as the block.
  if (!parsed || !looksLikeBlock(parsed)) return null;
  return { cutAt: tail.start, parsed };
}

/**
 * The first marker that has an object after it. The lookahead is what makes the
 * loose pattern safe: prose can say "the [loom] of fate", and cutting the beat
 * there would throw away the narration.
 */
function markerAt(raw: string): { index: number; end: number } | null {
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(raw)) !== null) {
    const end = m.index + m[0].length;
    if (AFTER_MARKER.test(raw.slice(end, end + MARKER_LOOKAHEAD))) return { index: m.index, end };
  }
  return null;
}

/** Every field of the contract, plus the names models reach for instead. */
const BLOCK_KEYS = [
  "location",
  "weather",
  "duration",
  "day",
  "options",
  "party",
  "conditions",
  "inventory",
  "quests",
  "notes",
  "spoke",
];

/** Does this object look like a turn block rather than a brace in the prose? */
function looksLikeBlock(parsed: Record<string, unknown>): boolean {
  return [...BLOCK_KEYS, ...OPTION_ALIASES].some((key) => key in parsed);
}

/** A trailing code fence, left behind when the block was fenced. */
function stripTrailingFence(text: string): string {
  return text
    .trimEnd()
    .replace(/```[ \t]*(?:json)?$/i, "")
    .trimEnd();
}

/**
 * Extract the first brace-balanced `{…}` object from `text`, ignoring braces
 * inside strings. Returns the raw substring, or null if none is balanced.
 * Exported so other model-JSON readers (autoUpdate.ts) salvage identically.
 */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // Unbalanced (truncated stream): salvage by closing the open braces.
  if (depth > 0) return text.slice(start) + "}".repeat(depth);
  return null;
}

/**
 * `extractFirstJsonObject`'s mirror: the LAST top-level brace-balanced object,
 * with where it started. That index is the whole point — it is where the prose
 * has to be cut when the model emitted a block with no marker in front of it.
 *
 * Nesting is tracked so the last TOP-LEVEL object is returned, not the last
 * inner one; a truncated final object wins over an earlier complete one, since
 * it is the later of the two.
 */
export function extractLastJsonObject(text: string): { json: string; start: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  let last: { json: string; start: number } | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      // A stray `}` in the prose: not a close, so it can't open a run.
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start !== -1) last = { json: text.slice(start, i + 1), start };
    }
  }

  if (depth > 0 && start !== -1) return { json: text.slice(start) + "}".repeat(depth), start };
  return last;
}

/** JSON.parse with a light salvage pass for trailing commas. */
export function parseJsonTolerant<T>(json: string): T | null {
  const attempts = [json, json.replace(/,\s*([}\]])/g, "$1")];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object") return parsed as T;
    } catch {
      // try next salvage form
    }
  }
  return null;
}

/** Most buttons a beat can offer — the prompt asks for 3–4. */
export const MAX_OPTIONS = 4;

/** A single option, past which it stops being a button and starts being prose. */
const MAX_OPTION_LENGTH = 120;

/** What models call `options` when they don't call it `options`. */
const OPTION_ALIASES = [
  "actions",
  "choices",
  "suggestions",
  "next_actions",
  "nextActions",
  "action_options",
];

/** Keys an option object hides its text under. */
const OPTION_TEXT_KEYS = ["text", "label", "action", "option", "title", "name", "description"];

/** The options off a parsed block, and whether it named the field at all. */
function readOptions(parsed: Record<string, unknown> | null): {
  options: string[];
  hadKey: boolean;
} {
  if (!parsed) return { options: [], hadKey: false };
  if ("options" in parsed) return { options: normalizeOptions(parsed.options), hadKey: true };
  for (const alias of OPTION_ALIASES) {
    if (alias in parsed) return { options: normalizeOptions(parsed[alias]), hadKey: true };
  }
  return { options: [], hadKey: false };
}

/**
 * Anything a model has put in `options`, as the `string[]` the type promises.
 *
 * `LoomBlock.options?: string[]` was never checked, and the shapes that arrive
 * instead are not harmless: an array of objects reaches the option button as a
 * React child and throws, taking the reading area with it. Every coercion here
 * is a shape seen from a real model — a single newline-separated string, rows
 * under `{ "action": … }`, options that number themselves, a `{ "1": … }` map.
 */
export function normalizeOptions(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const entry of optionEntries(value)) {
    for (const text of optionTexts(entry)) {
      const clean = cleanOption(text);
      if (!clean) continue;
      // Case-insensitive: an option offered twice is one button, and a model
      // that repeats itself usually changes the capitals.
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
      if (out.length === MAX_OPTIONS) return out;
    }
  }

  return out;
}

/** The top level: an array, one string holding all of them, or a map. */
function optionEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return splitOptionText(value);
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

/** One entry, flattened to the strings inside it. */
function optionTexts(entry: unknown): string[] {
  if (typeof entry === "string") return splitOptionText(entry);
  if (typeof entry === "number") return [String(entry)];
  if (Array.isArray(entry)) return entry.flatMap(optionTexts);
  if (entry && typeof entry === "object") {
    const row = entry as Record<string, unknown>;
    for (const key of OPTION_TEXT_KEYS) {
      if (typeof row[key] === "string") return splitOptionText(row[key] as string);
    }
    // No known key — take the only string it has, if it has exactly one. Two
    // and we would be guessing which is the button and which is the reason.
    const strings = Object.values(row).filter((v): v is string => typeof v === "string");
    return strings.length === 1 ? splitOptionText(strings[0]) : [];
  }
  return [];
}

/** Lines, ` | `-separated runs, and self-numbered options on one line. */
function splitOptionText(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line) => line.split(" | "))
    // "1. Go north 2. Wait" — one line, two options.
    .flatMap((line) => line.split(/\s+(?=\(?\d{1,2}[.)]\s)/))
    .map((line) => line.trim())
    .filter(Boolean);
}

/** A list marker the model wrote itself — the UI numbers the buttons. */
const LIST_MARKER = /^\s*(?:[-*•·–—]+|\(?\d{1,2}[.)\]])\s+/;

/** One option, trimmed of its numbering, quotes and bold. */
function cleanOption(text: string): string {
  let clean = text.trim().replace(LIST_MARKER, "").trim();
  // `**Scan the treeline**` — the whole option in bold is decoration, not
  // emphasis, and a button label renders no markdown.
  clean = clean.replace(/^\*\*(.*)\*\*$/s, "$1").trim();
  clean = clean.replace(/^["“'](.*)["”']$/s, "$1").trim();
  if (clean.length > MAX_OPTION_LENGTH) clean = clean.slice(0, MAX_OPTION_LENGTH).trimEnd();
  return clean;
}

/** A prose line that is a list item — the shape options take when misplaced. */
const LIST_LINE = /^\s*(?:[-*•·–—]|\(?\d{1,2}[.)\]])\s+\S/;

/** The line that introduces such a list, absorbed with it when it is there. */
const LIST_PROMPT_LINE = /^[\s*_>#]*(?:what (?:do|will|would) you|your options|options|choose|choices|you (?:could|can))\b/i;

/** Longer than this and a bullet is a sentence of narration, not a button. */
const MAX_LIST_LINE = 100;

/** How many trailing list lines can plausibly be the options. */
const MIN_LIST_LINES = 2;
const MAX_LIST_LINES = 6;

/**
 * Options a model wrote into the prose as a trailing numbered list, lifted out
 * and removed from the narration.
 *
 * This is the second thing in the app to read the prose for meaning (speaker
 * detection is the first), and it is deliberately narrow: a contiguous run at
 * the very END of the beat, every line a short list item, at least two of them.
 * Nothing else in a beat is touched, and a beat without such a run is returned
 * unchanged — `null`, so the caller keeps its own prose reference.
 *
 * Returning options is not the only point. A list left in the prose is a list
 * in the reading pane, in the history the model reads back, and therefore in
 * the habit it is learning; taking it out fixes all three.
 */
export function extractProseOptions(
  prose: string,
): { prose: string; options: string[] } | null {
  const lines = prose.split("\n");

  // Trailing blank lines are not part of the run.
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;

  let start = end;
  for (let i = end - 1; i >= 0; i--) {
    const line = lines[i];
    // A blank line inside the run is fine, as long as a list line precedes it.
    if (!line.trim()) {
      if (start < end && i > 0 && LIST_LINE.test(lines[i - 1])) continue;
      break;
    }
    if (!LIST_LINE.test(line) || line.trim().length > MAX_LIST_LINE) break;
    start = i;
  }

  const items = lines.slice(start, end).filter((l) => l.trim());
  if (items.length < MIN_LIST_LINES || items.length > MAX_LIST_LINES) return null;

  const options = normalizeOptions(items);
  // A run that collapses to one button is not worth rewriting a beat for.
  if (options.length < MIN_LIST_LINES) return null;

  // "What do you do?" belongs to the list, not to the story.
  let cut = start;
  for (let i = start - 1; i >= 0; i--) {
    if (!lines[i].trim()) {
      cut = i;
      continue;
    }
    if (LIST_PROMPT_LINE.test(lines[i]) && lines[i].trim().length <= MAX_LIST_LINE) cut = i;
    break;
  }

  const kept = lines.slice(0, cut).join("\n").trimEnd();
  // A beat that is nothing BUT the list: keep the buttons, keep the prose. An
  // empty `prose` makes the store fall back to the raw response, JSON and all.
  return { prose: kept || prose, options };
}

/**
 * Whether this turn's block is worth one repair call (`Settings.repairBlock`).
 *
 * Two failures qualify, and both are "the turn produced nothing the client can
 * use": no block at all — so no deltas either — or a block that parsed but left
 * the player with no buttons. Everything else a block can omit is legitimately
 * absent on a quiet turn, and an empty block is a valid turn.
 *
 * Checked AFTER every salvage path in `parseLoomResponse`, so a model whose
 * options were merely misplaced never costs a second request.
 */
export function needsBlockRepair(settings: Settings, block: LoomBlock | null): boolean {
  if (!settings.repairBlock) return false;
  // A game with every narrator channel switched off loses nothing when a block
  // goes missing: there was nothing for it to carry. Buying back an empty
  // object is the one repair that can never pay for itself.
  if (!writesBlock(settings.features)) return false;
  if (!block) return true;
  return settings.features.options && !block.options?.length;
}

/**
 * Fold a repair response into the turn's block.
 *
 * The asymmetry is the important part. When nothing was readable, nothing was
 * applied, and the repair IS the block. When a block DID parse, its ops have
 * already run: taking anything but `options` from a second response would apply
 * them twice, and a duplicate `add` carrying a quantity is not a no-op
 * `reconcileBlock` can fold away.
 */
export function mergeRepairBlock(
  block: LoomBlock | null,
  repaired: LoomBlock | null,
): LoomBlock | null {
  if (!repaired) return block;
  if (!block) return repaired;
  const options = normalizeOptions(repaired.options);
  if (!options.length) return block;
  return { ...block, options };
}
