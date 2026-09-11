import type { Block, Character, GameState, Settings } from "../types";
import { type ChatMessage, formatScenarioBlock } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { formatSheet } from "./autoUpdate";
import { activeTemplate } from "./imageTemplates";
import { formatWorldNotesBlock, matchWorldNotes } from "./worldNotes";

/**
 * Per-block character generation — a side call (never part of a turn) that asks
 * the text model to write ONE Text block's content from scratch. Opened from
 * the ✦ button beside a block on the member sheet.
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
 * Unlike the pre-block version, the block being written is not a fixed union —
 * a player can add any number of custom blocks — so the JSON contract is now
 * ONE fixed key, `"text"`, for every block; the block's own `title` becomes
 * the field label the model is told to write.
 *
 * Pure + tested: prompt assembly and response parsing live here; only the store
 * touches the network.
 */

/**
 * Looser than the 0.4 of a sheet UPDATE. That one is maintenance and should
 * stay close to what is already written; this one is authoring, and a player who
 * presses Generate Again wants a different answer, not the same one hedged.
 */
export const GENERATE_FIELD_TEMPERATURE = 0.9;

const DEFAULT_APPEARANCE_RULE = '"text" is physical appearance only, concrete and visual.';

export interface GenerateFieldOptions {
  game: GameState;
  settings: Settings;
  /**
   * The character AS SHOWN ON SCREEN — the sheet's edit draft, not the saved
   * record. A block generated while the player has just typed a Personality
   * block must read that Personality.
   */
  character: Character;
  /** The block being written — its title becomes the field label, its kind selects the rule (Appearance is special). */
  block: Pick<Block, "title" | "kind">;
  /** The player's optional "what I want in it" note. */
  hint?: string;
}

/**
 * The text the World Notes matcher scans: who this character is, plus every
 * block's title and text, plus whatever the player asked for. Deliberately
 * NOT the story — a note is pulled in here because it is about this
 * character's species, home or trade, not because it came up three turns ago.
 */
export function fieldScanText(character: Character, hint?: string): string {
  return [
    character.name,
    character.species,
    character.sex,
    ...character.blocks.flatMap((b) => [b.title, b.text]),
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

/**
 * The rule for one block: the player's appearance sentence for an
 * Appearance-kind block (the same rule the narrator gets, so "Appearance"
 * means one thing app-wide), or a generic rule keyed to its title for
 * everything else — Strengths, Flaws, Notes, and any custom block a player
 * has added.
 */
function fieldRule(block: Pick<Block, "title" | "kind">, settings: Settings): string {
  if (block.kind === "appearance") {
    return activeTemplate(settings).appearanceInstructions.trim() || DEFAULT_APPEARANCE_RULE;
  }
  const label = block.title.trim() || "this block";
  return `"text" is the content of the "${label}" block — a sentence or two of plain prose, consistent with the rest of the sheet.`;
}

/**
 * The messages[] for one block-generation call: role + the single block's rule,
 * the scenario, the whole current sheet, the World Notes this character's own
 * words trigger, and the player's hint when they gave one.
 */
export function buildFieldMessages(opts: GenerateFieldOptions): ChatMessage[] {
  const { game, settings, character, block } = opts;
  const label = block.title.trim() || "this block";
  const hint = (opts.hint ?? "").trim();

  const messages: ChatMessage[] = [];

  messages.push({
    role: "system",
    content: [
      "CHARACTER FIELD — you are writing ONE block of one character's sheet for a text adventure.",
      `Reply with a single JSON object and nothing else — no prose, no commentary, no code fences. It has exactly one key, "text", whose value is a plain string.`,
      "",
      "THE FIELD",
      `- ${fieldRule(block, settings)}`,
      "",
      "RULES",
      "- Write this field FRESH. Whatever it currently holds is a draft to replace, not text to preserve.",
      // Named only when they exist: "Sex is FIXED" about a blank sex reads as an
      // instruction to invent one and hold to it, which is the player's call.
      fixedTraitsRule(character),
      "- Stay consistent with every other block on the sheet below, and inside the scenario's setting, tone and vocabulary.",
      `- Write ONLY ${label}. Nothing about the other blocks, and no name.`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const scenario = formatScenarioBlock(game.scenario);
  if (scenario) messages.push({ role: "system", content: scenario });

  // The whole sheet — the blocks not being written are the constraints.
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
 * Takes the key as a plain string, not a fixed union: `generateScenario.ts`
 * asks for `premise` / `openingNarration` through the same one-key JSON
 * contract, and the character-field flow always asks for `"text"` — two
 * copies of a tolerant parser is exactly how the two would drift apart.
 */
export function parseGeneratedField(raw: string, field: string): string {
  const json = extractFirstJsonObject(raw);
  if (!json) return "";
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return "";
  const value = parsed[field];
  return typeof value === "string" ? value.trim() : "";
}
