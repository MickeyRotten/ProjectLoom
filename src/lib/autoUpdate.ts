import type { Character, GameState, Message } from "../types";
import type { ChatMessage } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";

/**
 * Character-sheet auto-update — a side call (never part of a turn) that asks the
 * text model to rewrite selected sheet fields from the current sheet + the
 * story so far. Opened from the member sheet, one character at a time.
 *
 * Only three fields are ever writable, each with its own rule:
 *   - appearance  → `description`: physical characteristics are PRESERVED; only
 *     what the character wears/carries is rewritten to match their Equipment.
 *   - personality → from the latest beats that mention the character by name.
 *   - drive       → same context, same rule.
 * Strengths and Equipment are deliberately never touched — the player owns them
 * (equipment is what appearance reads *from*, so letting the model rewrite both
 * would close a feedback loop on itself).
 *
 * Pure + tested: prompt assembly and response parsing live here; only the store
 * touches the network.
 */

/** The player-selectable fields, in display order. */
export type AutoField = "appearance" | "personality" | "drive";

export const AUTO_FIELDS: AutoField[] = ["appearance", "personality", "drive"];

/** Sheet field each selectable field writes to. */
const TARGET: Record<AutoField, "description" | "personality" | "drive"> = {
  appearance: "description",
  personality: "personality",
  drive: "drive",
};

/** How many name-mentioning beats fold into the personality/drive scan. */
export const MENTION_SCAN_LIMIT = 12;

/** Tighter than narration — a sheet rewrite should not freewheel. */
export const AUTO_UPDATE_TEMPERATURE = 0.4;

/** What a successful auto-update writes back onto the character. */
export type AutoUpdatePatch = Partial<Pick<Character, "description" | "personality" | "drive">>;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-boundary, case-insensitive name hit (same shape as the World Notes matcher). */
function mentionsName(text: string, name: string): boolean {
  const pattern = escapeRe(name.trim()).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\w])${pattern}(?![\\w])`, "i").test(text);
}

/**
 * The latest `limit` messages whose text mentions `name`, scanned newest-first
 * but returned in story order (oldest → newest). A blank name matches nothing —
 * an unnamed character has no beats to learn from.
 */
export function recentMentions(
  messages: Message[],
  name: string,
  limit = MENTION_SCAN_LIMIT,
): Message[] {
  if (!name.trim() || limit <= 0) return [];
  const hits: Message[] = [];
  for (let i = messages.length - 1; i >= 0 && hits.length < limit; i--) {
    if (mentionsName(messages[i].content, name)) hits.unshift(messages[i]);
  }
  return hits;
}

/* ---------------------------- prompt assembly ---------------------------- */

/**
 * Per-field rules handed to the model. Only the selected ones are sent, so the
 * model is never told about a field it must not write.
 */
const FIELD_RULES: Record<AutoField, string> = {
  appearance: `- "appearance" — PRESERVE the character's physical characteristics exactly as written: species, build, height, hair, eyes, skin, scars, and any distinguishing features carry over unchanged. Rewrite ONLY what they are wearing and carrying, so it matches the EQUIPMENT list below — read each item's label AND description. Never invent gear that is not in that list, and never drop gear that is. Physical appearance only, concrete and visual: no personality, no backstory.`,
  personality: `- "personality" — update the character's temperament and speech habits from how they actually behave in the STORY CONTEXT below. Keep established traits that still hold; change or add only what the recent story has earned. A phrase or two, no backstory.`,
  drive: `- "drive" — update the one thing this character wants, from the STORY CONTEXT below. Keep the existing drive unless the story has genuinely moved it. One short sentence.`,
};

const FIELD_LABEL: Record<AutoField, string> = {
  appearance: "Appearance",
  personality: "Personality",
  drive: "Drive",
};

export interface AutoUpdateOptions {
  game: GameState;
  character: Character;
  fields: AutoField[];
  /** Beats scanned for personality/drive context. */
  mentionLimit?: number;
}

/** Selected fields in canonical order, de-duplicated. */
export function normalizeFields(fields: AutoField[]): AutoField[] {
  return AUTO_FIELDS.filter((f) => fields.includes(f));
}

/**
 * The messages[] for one sheet-update call: role + per-field rules, the full
 * current sheet (equipment included — appearance reads from it), the beats that
 * mention the character (only when a story-driven field is selected), and the
 * final "emit JSON now" instruction.
 */
export function buildAutoUpdateMessages(opts: AutoUpdateOptions): ChatMessage[] {
  const fields = normalizeFields(opts.fields);
  const { game, character } = opts;
  const keys = fields.map((f) => `"${f}"`).join(", ");

  const messages: ChatMessage[] = [];

  messages.push({
    role: "system",
    content: [
      "CHARACTER SHEET UPDATE — you are maintaining one character's sheet for an ongoing text adventure.",
      "Rewrite ONLY the fields listed below, then reply with a single JSON object and nothing else — no prose, no commentary, no code fences.",
      `The object contains exactly these keys, each a plain string: ${keys}.`,
      "Match the existing voice and length of each field; this is an update, not a rewrite from scratch.",
      "",
      "FIELDS TO UPDATE",
      ...fields.map((f) => FIELD_RULES[f]),
    ].join("\n"),
  });

  // The scenario, so an update stays inside the setting's idiom.
  const s = game.scenario;
  if (s.title.trim() || s.premise.trim()) {
    messages.push({
      role: "system",
      content: `SCENARIO — ${s.title}\n${s.premise}`.trim(),
    });
  }

  messages.push({ role: "system", content: formatSheet(character) });

  // Story context only matters to the fields that read the story.
  if (fields.some((f) => f !== "appearance")) {
    messages.push({
      role: "system",
      content: formatStoryContext(
        recentMentions(game.messages, character.name, opts.mentionLimit ?? MENTION_SCAN_LIMIT),
        character.name,
      ),
    });
  }

  messages.push({
    role: "user",
    content: `Update ${fields.map((f) => FIELD_LABEL[f]).join(", ")} for ${
      character.name || "this character"
    }. Emit the JSON object now.`,
  });

  return messages;
}

/** The whole sheet as the model sees it — every field, editable or not. */
export function formatSheet(c: Character): string {
  const equipment = c.equipment.length
    ? c.equipment.map((e) => `  - ${e.label}${e.description ? `: ${e.description}` : ""}`).join("\n")
    : "  (none)";
  return [
    `CURRENT SHEET — ${c.name || "(unnamed)"}${c.species ? ` (${c.species})` : ""}`,
    `Appearance: ${c.description || "(blank)"}`,
    `Personality: ${c.personality || "(blank)"}`,
    `Drive: ${c.drive || "(blank)"}`,
    `Strengths — ${c.strengths.name || "(blank)"}: ${c.strengths.description || "(blank)"}`,
    `EQUIPMENT — what this character is currently wearing and carrying:`,
    equipment,
  ].join("\n");
}

/** The name-mentioning beats, oldest → newest, or an explicit "nothing recent". */
export function formatStoryContext(beats: Message[], name: string): string {
  const who = name.trim() || "this character";
  if (!beats.length) {
    return `STORY CONTEXT — no recent beat mentions ${who}. Keep the existing values unless the sheet itself contradicts them.`;
  }
  const lines = beats.map(
    (m) => `[turn ${m.turn} · ${m.role === "player" ? "player" : "narrator"}] ${m.content.trim()}`,
  );
  return `STORY CONTEXT — the most recent beats mentioning ${who}, oldest first\n${lines.join("\n\n")}`;
}

/* ---------------------------- response parsing ---------------------------- */

/**
 * Pull the sheet patch out of a model reply. Tolerant like the <<<LOOM>>>
 * parser (fences/preamble/trailing commas survive); strict about content —
 * only requested keys are read, only non-blank strings are kept, so a partial
 * or chatty reply degrades to "fewer fields updated" instead of blanking a
 * sheet. Returns {} when nothing usable came back.
 */
export function parseAutoUpdate(raw: string, fields: AutoField[]): AutoUpdatePatch {
  const json = extractFirstJsonObject(raw);
  if (!json) return {};
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return {};

  const patch: AutoUpdatePatch = {};
  for (const field of normalizeFields(fields)) {
    const value = parsed[field];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    patch[TARGET[field]] = trimmed;
  }
  return patch;
}
