import type { Character, GameState } from "../types";
import { type ChatMessage } from "./prompt";
import { formatIdentity, playerCharacter } from "./roster";
import { formatWorldNotesBlock, matchWorldNotes } from "./worldNotes";

/**
 * Per-field SCENARIO generation — `generateField.ts`'s sibling one level up.
 * That one writes a field of a character sheet; this one writes the Premise or
 * the Opening Narration, from the ✦ button beside each on the Scenario screen.
 *
 * Same contract in both directions: one field per call, a single-key JSON reply
 * parsed by `parseGeneratedField`, a preview the player accepts or re-rolls, and
 * nothing written until they do. The context is what the scenario already has —
 * its title, its other field, the player character, and the World Notes those
 * words touch — and never the beats: this is the text a NEW adventure starts
 * from, so reading the one being played would be backwards.
 *
 * Pure + tested: prompt assembly here, network in the store.
 */

/** The scenario fields a ✦ button is offered for. */
export type ScenarioField = "premise" | "openingNarration";

export const SCENARIO_FIELDS: ScenarioField[] = ["premise", "openingNarration"];

export const SCENARIO_FIELD_LABEL: Record<ScenarioField, string> = {
  premise: "Premise",
  openingNarration: "Opening Narration",
};

/** Authoring, like the character fields — a re-roll should differ, not hedge. */
export const GENERATE_SCENARIO_TEMPERATURE = 0.9;

/**
 * What each field is. Only the requested one is sent, so the model is never
 * told about a field it must not write (`generateField.ts → GEN_FIELD_RULES`).
 */
const SCENARIO_FIELD_RULES: Record<ScenarioField, string> = {
  premise: `"premise" is the SETTING — the world this adventure happens in, who lives in it, what makes it worth playing in, and the tone it is played in. A paragraph of plain prose in third person. It is background the narrator reads every single turn, so write the world, not a plot and not an opening scene.`,
  openingNarration: `"openingNarration" is the FIRST BEAT the player reads, written exactly as the narrator writes every other beat: second person ("you"), present tense, a few tight sentences of concrete sensory detail that put the player somewhere specific with something in front of them. End on the question of what they do. No backstory dump, no title, no menu text.`,
};

export interface GenerateScenarioOptions {
  /** The adventure as it stands — its scenario, its world notes. */
  game: GameState;
  /** The cast library, for the player character the opening has to feature. */
  characters: Character[];
  field: ScenarioField;
  /** The player's optional "what I want in it" note. */
  hint?: string;
}

/**
 * The text the World Notes matcher scans: everything the scenario already says,
 * plus whatever the player asked for. A note about the Sunken Choir belongs in a
 * premise that names it.
 */
export function scenarioScanText(game: GameState, hint?: string): string {
  const s = game.scenario;
  return [s.title, s.startLocation, s.premise, s.openingNarration, hint ?? ""]
    .filter(Boolean)
    .join("\n");
}

/**
 * The scenario as CONTEXT — everything except the field being written, which is
 * a draft to replace rather than text to stay close to.
 */
function contextBlock(game: GameState, field: ScenarioField): string {
  const s = game.scenario;
  const lines = [
    "THIS SCENARIO",
    s.title.trim() ? `Title: ${s.title.trim()}` : "",
    s.startLocation?.trim() ? `Opens at: ${s.startLocation.trim()}` : "",
    `Day ${s.startDay}`,
    field !== "premise" && s.premise.trim() ? `Premise: ${s.premise.trim()}` : "",
    field !== "openingNarration" && s.openingNarration.trim()
      ? `Opening narration: ${s.openingNarration.trim()}`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
}

/** The PC the opening beat has to stand up and look around. */
function playerBlock(game: GameState, characters: Character[]): string {
  const pc = playerCharacter(characters, game.roster);
  if (!pc) return "";
  return [
    `PLAYER CHARACTER — ${formatIdentity(pc)}`,
    pc.description,
    pc.personality ? `Personality: ${pc.personality}` : "",
    pc.drive ? `Drive: ${pc.drive}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The messages[] for one scenario-field call: role + that field's rule, the rest
 * of the scenario, the player character, the World Notes the scenario's own
 * words trigger, and the player's hint when they gave one.
 */
export function buildScenarioMessages(opts: GenerateScenarioOptions): ChatMessage[] {
  const { game, characters, field } = opts;
  const label = SCENARIO_FIELD_LABEL[field];
  const hint = (opts.hint ?? "").trim();

  const messages: ChatMessage[] = [];

  messages.push({
    role: "system",
    content: [
      "SCENARIO FIELD — you are writing ONE field of the setup for a single-player text adventure.",
      `Reply with a single JSON object and nothing else — no prose, no commentary, no code fences. It has exactly one key, "${field}", whose value is a plain string.`,
      "",
      "THE FIELD",
      `- ${SCENARIO_FIELD_RULES[field]}`,
      "",
      "RULES",
      "- Write this field FRESH. Whatever it currently holds is a draft to replace, not text to preserve.",
      "- Stay consistent with the rest of the scenario below — its title, its setting, its tone and its vocabulary.",
      `- Write ONLY ${label}. Nothing about the other fields, and no headings or labels.`,
    ].join("\n"),
  });

  const context = contextBlock(game, field);
  if (context) messages.push({ role: "system", content: context });

  // The opening beat is written AT someone; the premise is the world they are
  // standing in. Both read better for knowing who the player is.
  const player = playerBlock(game, characters);
  if (player) messages.push({ role: "system", content: player });

  const notes = formatWorldNotesBlock(
    matchWorldNotes(game.worldNotes, scenarioScanText(game, hint)),
  );
  if (notes) messages.push({ role: "system", content: notes });

  // Last, so it outranks the scenario it may well contradict on purpose.
  if (hint) {
    messages.push({
      role: "system",
      content: `PLAYER GUIDANCE — what the player wants in this field. Follow it even where it cuts against the rest of the scenario.\n${hint}`,
    });
  }

  messages.push({
    role: "user",
    content: `Write ${label}. Emit the JSON object now.`,
  });

  return messages;
}
