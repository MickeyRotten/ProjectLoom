import type { Character, GameState, Settings } from "../types";
import { type ChatMessage, formatScenarioBlock } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { formatSheet } from "./autoUpdate";
import { formatWorldNotesBlock, matchWorldNotes } from "./worldNotes";

/**
 * Per-field character generation — a side call (never part of a turn) that asks
 * the text model to write ONE prose field from scratch. Opened from the ✦
 * button beside each field on the member sheet, one field at a time.
 *
 * The sibling of `autoUpdate.ts`, and the difference is where it reads from:
 * Auto-Update re-reads a character off the STORY SO FAR, so it is a story
 * change. This is AUTHORING — it reads the character's own sheet (Species and
 * Sex above all), the scenario, and the World Notes those words trigger, and
 * never the beats. A character who has not appeared yet is exactly who this is
 * for, and they have no beats to be read off.
 *
 * It also never writes anything: the caller previews the text and drops it into
 * the sheet's edit draft, so Discard Changes is the undo.
 *
 * Pure + tested: prompt assembly and response parsing live here; only the store
 * touches the network.
 */

/** The fields a ✦ button is offered for, in sheet order. */
export type GenField = "description" | "personality" | "drive" | "strengths" | "flaws";

export const GEN_FIELDS: GenField[] = [
  "description",
  "personality",
  "drive",
  "strengths",
  "flaws",
];

/** Sheet field → the label the player sees, and the JSON key the model writes. */
export const GEN_FIELD_LABEL: Record<GenField, string> = {
  description: "Appearance",
  personality: "Personality",
  drive: "Drive",
  strengths: "Strengths",
  flaws: "Flaws",
};

/**
 * Looser than the 0.4 of a sheet UPDATE. That one is maintenance and should
 * stay close to what is already written; this one is authoring, and a player who
 * presses Generate Again wants a different answer, not the same one hedged.
 */
export const GENERATE_FIELD_TEMPERATURE = 0.9;

/**
 * What each field is, written for a model that has the sheet in front of it.
 * Only the requested field's rule is sent, so the model is never told about a
 * field it must not write (same discipline as `autoUpdate.ts → FIELD_RULES`).
 *
 * `description` is the exception: its rule is the player's
 * `Settings.appearanceInstructions`, the same sentence the narrator gets in the
 * output protocol, so "Appearance" means one thing app-wide.
 */
const GEN_FIELD_RULES: Record<Exclude<GenField, "description">, string> = {
  personality: `"personality" is temperament and speech habits — how they come across and how they talk — in a phrase or two. No backstory, no appearance.`,
  drive: `"drive" is the ONE thing this character wants, in one short sentence. Something concrete enough to act on, not a virtue.`,
  strengths: `"strengths" is what this character is genuinely good at, in a sentence or two of plain prose. Specific enough that a scene can turn on it.`,
  flaws: `"flaws" is what this character is bad at, in a sentence or two — the counterweight to their strengths, and something that can cost them.`,
};

const DEFAULT_APPEARANCE_RULE =
  '"description" is physical appearance only, concrete and visual.';

export interface GenerateFieldOptions {
  game: GameState;
  settings: Settings;
  /**
   * The character AS SHOWN ON SCREEN — the sheet's edit draft, not the saved
   * record. A Flaws generated while the player has just typed a Personality
   * must read that Personality.
   */
  character: Character;
  field: GenField;
  /** The player's optional "what I want in it" note. */
  hint?: string;
}

/**
 * The text the World Notes matcher scans: who this character is, plus whatever
 * the player asked for. Deliberately NOT the story — a note is pulled in here
 * because it is about this character's species, home or trade, not because it
 * came up three turns ago.
 */
export function fieldScanText(character: Character, hint?: string): string {
  return [
    character.name,
    character.species,
    character.sex,
    character.description,
    character.personality,
    character.drive,
    character.strengths,
    character.flaws,
    character.notes,
    ...(character.equipment ?? []).flatMap((e) => [e.label, e.description]),
    hint ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The "don't contradict these" line, naming only the traits actually filled in.
 * Species and Sex are the two the player is told the generation reads, so they
 * are the two the model is told it may not move.
 */
function fixedTraitsRule(character: Character): string {
  const fixed = [
    character.species.trim() && "Species",
    character.sex?.trim() && "Sex",
  ].filter(Boolean);
  if (!fixed.length) return "";
  const traits = fixed.join(" and ");
  const verb = fixed.length > 1 ? "are" : "is";
  return `- The character's ${traits} ${verb} FIXED — write someone who plainly matches, and never contradict ${
    fixed.length > 1 ? "either" : "it"
  }.`;
}

/** The rule for one field: the player's appearance sentence, or the built-in. */
function fieldRule(field: GenField, settings: Settings): string {
  if (field !== "description") return GEN_FIELD_RULES[field];
  return settings.appearanceInstructions.trim() || DEFAULT_APPEARANCE_RULE;
}

/**
 * The messages[] for one field-generation call: role + the single field's rule,
 * the scenario, the whole current sheet, the World Notes this character's own
 * words trigger, and the player's hint when they gave one.
 */
export function buildFieldMessages(opts: GenerateFieldOptions): ChatMessage[] {
  const { game, settings, character, field } = opts;
  const label = GEN_FIELD_LABEL[field];
  const hint = (opts.hint ?? "").trim();

  const messages: ChatMessage[] = [];

  messages.push({
    role: "system",
    content: [
      "CHARACTER FIELD — you are writing ONE field of one character's sheet for a text adventure.",
      `Reply with a single JSON object and nothing else — no prose, no commentary, no code fences. It has exactly one key, "${field}", whose value is a plain string.`,
      "",
      "THE FIELD",
      `- ${fieldRule(field, settings)}`,
      "",
      "RULES",
      "- Write this field FRESH. Whatever it currently holds is a draft to replace, not text to preserve.",
      // Named only when they exist: "Sex is FIXED" about a blank sex reads as an
      // instruction to invent one and hold to it, which is the player's call.
      fixedTraitsRule(character),
      "- Stay consistent with every other field on the sheet below, and inside the scenario's setting, tone and vocabulary.",
      `- Write ONLY ${label}. Nothing about the other fields, and no name.`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const scenario = formatScenarioBlock(game.scenario);
  if (scenario) messages.push({ role: "system", content: scenario });

  // The whole sheet — the fields not being written are the constraints.
  messages.push({
    role: "system",
    content: `${formatSheet(character)}\n\nWrite only: ${label}.`,
  });

  // Lore this character's own words reach for — species, homeland, order, trade.
  const notes = formatWorldNotesBlock(
    matchWorldNotes(game.worldNotes, fieldScanText(character, hint)),
  );
  if (notes) messages.push({ role: "system", content: notes });

  // Last, so it outranks the sheet it may well contradict on purpose.
  if (hint) {
    messages.push({
      role: "system",
      content: `PLAYER GUIDANCE — what the player wants in this field. Follow it even where it cuts against the sheet.\n${hint}`,
    });
  }

  messages.push({
    role: "user",
    content: `Write ${label} for ${character.name.trim() || "this character"}. Emit the JSON object now.`,
  });

  return messages;
}

/**
 * Pull the one field out of a model reply. Tolerant like the <<<LOOM>>> parser
 * (fences / preamble / trailing commas survive), strict about content — a
 * non-string or blank value reads as "nothing came back", so a chatty or
 * truncated reply leaves the sheet alone instead of blanking a field. Returns ""
 * when there is nothing usable.
 *
 * Takes the key as a plain string, not a `GenField`: `generateScenario.ts` asks
 * for `premise` / `openingNarration` through the same one-key JSON contract, and
 * two copies of a tolerant parser is exactly how the two would drift apart.
 */
export function parseGeneratedField(raw: string, field: string): string {
  const json = extractFirstJsonObject(raw);
  if (!json) return "";
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return "";
  const value = parsed[field];
  return typeof value === "string" ? value.trim() : "";
}
