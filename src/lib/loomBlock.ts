import type { LoomBlock } from "../types";

/**
 * The <<<LOOM>>> turn contract — parsing + streaming truncation.
 * See .claude/skills/loom-turn-protocol/SKILL.md (read before editing).
 *
 * Invariants enforced here:
 *  - Streaming display truncates at the first `<<<` so JSON never flashes.
 *  - Parse is tolerant: brace-matched salvage, and the block is ALWAYS stripped
 *    from displayed prose even when the JSON is malformed (bad JSON must never
 *    leak into chat).
 */

export const LOOM_OPEN = "<<<LOOM>>>";

/**
 * What the user sees while a response streams in: everything up to the first
 * `<<<`. Port of Wayward's StreamingWindow trick. Also hides a trailing partial
 * marker (1–2 `<` at the very end) so the `<<<` never flashes char-by-char as
 * it arrives.
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
 * Prose is taken as everything before the first `<<<`, regardless of whether
 * the JSON parses — so malformed blocks never leak.
 */
export function parseLoomResponse(raw: string): ParsedResponse {
  const prose = truncateForDisplay(raw);

  const open = raw.indexOf(LOOM_OPEN);
  if (open === -1) return { prose, block: null };

  const after = raw.slice(open + LOOM_OPEN.length);
  const json = extractFirstJsonObject(after);
  if (json === null) return { prose, block: null };

  const block = parseBlockTolerant(json);
  return { prose, block };
}

/**
 * Extract the first brace-balanced `{…}` object from `text`, ignoring braces
 * inside strings. Returns the raw substring, or null if none is balanced.
 */
function extractFirstJsonObject(text: string): string | null {
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

/** JSON.parse with a light salvage pass for trailing commas. */
function parseBlockTolerant(json: string): LoomBlock | null {
  const attempts = [json, json.replace(/,\s*([}\]])/g, "$1")];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object") return parsed as LoomBlock;
    } catch {
      // try next salvage form
    }
  }
  return null;
}
