import type { Character, Faction, GameState, Scenario } from "../types";
import { type ChatMessage, formatScenarioBlock } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { formatIdentity, playerCharacter } from "./roster";
import { formatWorldNotesBlock, matchWorldNotes } from "./worldNotes";

/**
 * Per-field SCENARIO generation — `generateField.ts`'s sibling one level up.
 * That one writes a field of a character sheet; this one writes one field of
 * the world seed, from the ✦ button beside each on the Scenario screen.
 *
 * Same contract in both directions: one field per call, a single-key JSON reply
 * parsed by `parseGeneratedField`, a preview the player accepts or re-rolls, and
 * nothing written until they do. The context is what the scenario already has —
 * its title, its other fields, the player character, and the World Notes those
 * words touch — and never the beats: this is the text a NEW adventure starts
 * from, so reading the one being played would be backwards.
 *
 * Pure + tested: prompt assembly here, network in the store.
 */

/** The scenario fields a ✦ button is offered for. */
export type ScenarioField =
  | "premise"
  | "tone"
  | "physicalLogic"
  | "dangerCurve"
  | "openingNarration";

export const SCENARIO_FIELDS: ScenarioField[] = [
  "premise",
  "tone",
  "physicalLogic",
  "dangerCurve",
  "openingNarration",
];

export const SCENARIO_FIELD_LABEL: Record<ScenarioField, string> = {
  premise: "Premise",
  tone: "Tone",
  physicalLogic: "Physical Logic",
  dangerCurve: "Danger Curve",
  openingNarration: "Opening Narration",
};

/** The list-shaped fields — one bullet per line, no markers, split on accept. */
export const SCENARIO_LIST_FIELDS: ScenarioField[] = ["tone", "physicalLogic", "dangerCurve"];

/** Authoring, like the character fields — a re-roll should differ, not hedge. */
export const GENERATE_SCENARIO_TEMPERATURE = 0.9;

/**
 * What each field is. Only the requested one is sent, so the model is never
 * told about a field it must not write (`generateField.ts → GEN_FIELD_RULES`).
 */
const SCENARIO_FIELD_RULES: Record<ScenarioField, string> = {
  premise: `"premise" is the SETTING — the world this adventure happens in, who lives in it, what makes it worth playing in, and the tone it is played in. A paragraph of plain prose in third person. It is background the narrator reads every single turn, so write the world, not a plot and not an opening scene.`,
  tone: `"tone" is the world's MOOD and its hard boundaries — what this world is, and what it deliberately is NOT. Write it as 2-4 short lines, one per line, with no leading dash or bullet marker — just the words themselves, newline-separated.`,
  physicalLogic: `"physicalLogic" is how this world WORKS — its scale, its tech/magic level, and any rule that should not be broken. Write it as 3-5 short lines, one per line, with no leading dash or bullet marker.`,
  dangerCurve: `"dangerCurve" is roughly how dangerous EARLY areas should feel versus LATE ones. Write it as 2-3 short lines, one per line, with no leading dash or bullet marker.`,
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
  return [
    s.title,
    s.startLocation,
    s.premise,
    ...s.tone,
    ...s.physicalLogic,
    ...s.factions.map((f) => f.name),
    ...s.threads,
    ...s.fixedPoints.map((f) => f.name),
    s.openingNarration,
    hint ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The scenario as CONTEXT — everything except the field being written, which is
 * a draft to replace rather than text to stay close to. The world-seed fields
 * this flow does not write directly (factions, fixed points) still ride along
 * as context — a new Premise should agree with an already-written faction.
 */
function contextBlock(game: GameState, field: ScenarioField): string {
  const s = game.scenario;
  const lines = [
    "THIS SCENARIO",
    s.title.trim() ? `Title: ${s.title.trim()}` : "",
    s.startLocation?.trim() ? `Opens at: ${s.startLocation.trim()}` : "",
    `Day ${s.startDay}`,
    field !== "premise" && s.premise.trim() ? `Premise: ${s.premise.trim()}` : "",
    field !== "tone" && s.tone.length ? `Tone: ${s.tone.join("; ")}` : "",
    field !== "physicalLogic" && s.physicalLogic.length
      ? `How this world works: ${s.physicalLogic.join("; ")}`
      : "",
    field !== "dangerCurve" && s.dangerCurve.length
      ? `Danger curve: ${s.dangerCurve.join("; ")}`
      : "",
    s.factions.length
      ? `Factions: ${s.factions.map((f) => f.name).join(", ")}`
      : "",
    s.fixedPoints.length
      ? `Already exists: ${s.fixedPoints.map((f) => f.name).join(", ")}`
      : "",
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

/* ------------------------------------------------------------------ *
 * Faction / Fixed Point row generation
 * ------------------------------------------------------------------ */

/**
 * The two row-shaped world-seed fields — `Faction` and `FixedPoint` are the
 * same {name, description} shape, so one generator serves both, the same way
 * `generateItem.ts` serves both the pack and a member's kit.
 */
export type SeedRowKind = "faction" | "fixedPoint";

const SEED_ROW_LABEL: Record<SeedRowKind, string> = {
  faction: "Faction",
  fixedPoint: "Fixed Point",
};

const SEED_ROW_RULES: Record<SeedRowKind, string[]> = {
  faction: [
    '- "name" is the faction\'s name — a few words, no titles or epithets tacked on.',
    '- "description" is one or two lines: what they want, and who or what they are already in tension with.',
  ],
  fixedPoint: [
    '- "name" is a proper noun that already exists in this world — a place or a person.',
    '- "description" is one line: what it is, or who they are, and why it already matters.',
  ],
};

export interface GenerateSeedRowOptions {
  game: GameState;
  kind: SeedRowKind;
  /** The other rows already written, excluding the one being replaced. */
  existing: Faction[];
  /** The player's optional "what I want" note. */
  hint?: string;
}

/** What is already there, so the model writes a different one rather than a repeat. */
function formatKnownSeedRows(kind: SeedRowKind, existing: Faction[]): string {
  const rows = existing.filter((r) => r.name.trim());
  if (!rows.length) return "";
  const label = kind === "faction" ? "FACTIONS" : "FIXED POINTS";
  const lines = rows.map((r) => `- ${r.name}${r.description ? `: ${r.description}` : ""}`);
  return [`ALREADY IN THE WORLD — other ${label} already written`, ...lines, "Do not repeat one of these."].join(
    "\n",
  );
}

/**
 * The messages[] for one faction / fixed-point call: role + that row's rules,
 * the world seed as it stands, the other rows already written, the World
 * Notes those names touch, and the player's hint when they gave one.
 */
export function buildSeedRowMessages(opts: GenerateSeedRowOptions): ChatMessage[] {
  const { game, kind, existing } = opts;
  const label = SEED_ROW_LABEL[kind];
  const hint = (opts.hint ?? "").trim();

  const messages: ChatMessage[] = [];

  messages.push({
    role: "system",
    content: [
      `WORLD SEED — you are writing ONE ${label.toUpperCase()} for this world's standing background.`,
      `Reply with a single JSON object and nothing else — no prose, no commentary, no code fences. It has exactly two keys, "name" and "description", both plain strings.`,
      "",
      "THE ENTRY",
      ...SEED_ROW_RULES[kind],
      "",
      "RULES",
      "- Write ONE, not a list.",
      "- It belongs in this world: the scenario's setting, tone and physical logic below decide what can exist.",
      "- Do not repeat anything already written below.",
    ].join("\n"),
  });

  const scenario = formatScenarioBlock(game.scenario);
  if (scenario) messages.push({ role: "system", content: scenario });

  const known = formatKnownSeedRows(kind, existing);
  if (known) messages.push({ role: "system", content: known });

  const notes = formatWorldNotesBlock(
    matchWorldNotes(game.worldNotes, [hint, ...existing.map((r) => r.name)].filter(Boolean).join("\n")),
  );
  if (notes) messages.push({ role: "system", content: notes });

  if (hint) {
    messages.push({
      role: "system",
      content: `PLAYER GUIDANCE — what the player wants in it. Follow it.\n${hint}`,
    });
  }

  messages.push({
    role: "user",
    content: `Write one ${label.toLowerCase()}. Emit the JSON object now.`,
  });

  return messages;
}

/**
 * Pull the row out of a model reply. Tolerant like every other parser in the
 * app, strict about one thing: a row with no name is nothing at all, so that
 * reads as "nothing came back" and the row is left exactly as the player had
 * it.
 */
export function parseGeneratedSeedRow(raw: string): Faction | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return null;

  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  if (!name) return null;

  return {
    name,
    description: typeof parsed.description === "string" ? parsed.description.trim() : "",
  };
}

/* ------------------------------------------------------------------ *
 * "Auto-Generate Other Fields" — the whole rest of the seed, one call
 * ------------------------------------------------------------------ */

/** How many Factions the bundle writes. Fixed Points and Open Threads are excluded by design. */
const BUNDLE_FACTION_COUNT = 2;

const SCENARIO_BUNDLE_RULES = [
  '- "title" is the adventure\'s title: a few words, no subtitle.',
  '- "startLocation" is the one proper-noun place the opening beat stands in — short, no compound joiners (no " - " or "/").',
  `- "tone" is the world's MOOD and its hard boundaries — what this world is, and what it deliberately is NOT — as a JSON array of 2-4 short strings.`,
  `- "physicalLogic" is how this world WORKS — its scale, its tech/magic level, and any rule that should not be broken — as a JSON array of 3-5 short strings.`,
  `- "dangerCurve" is roughly how dangerous EARLY areas should feel versus LATE ones — as a JSON array of 2-3 short strings.`,
  `- "factions" is a JSON array of exactly ${BUNDLE_FACTION_COUNT} named powers already in tension, each an object {"name": ..., "description": ...} — description is one or two lines: what they want, and who or what they are already in tension with.`,
  '- "openingNarration" is the FIRST BEAT the player reads: second person ("you"), present tense, a few tight sentences of concrete sensory detail that put the player somewhere specific with something in front of them, ending on the question of what they do. No backstory dump, no title, no menu text.',
].join("\n");

export interface GenerateScenarioBundleOptions {
  /** The adventure as it stands — read only for its Premise and its World Notes. */
  game: GameState;
  /** The cast library, for the player character the opening has to feature. */
  characters: Character[];
}

/**
 * The messages[] for the "Auto-Generate Other Fields" button under Premise:
 * one call that writes the rest of the world seed — Title, Starting Location,
 * Tone, Physical Logic, Danger Curve, two Factions, and the Opening Narration
 * — from the Premise alone. Fixed Points and Open Threads are deliberately
 * left out (DESIGN.md decision: those stay player-authored), and nothing else
 * already written rides along as context, since this button exists to fill a
 * scenario in from just its Premise.
 */
export function buildScenarioBundleMessages(opts: GenerateScenarioBundleOptions): ChatMessage[] {
  const { game, characters } = opts;
  const premise = game.scenario.premise.trim();

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "WORLD SEED — you are writing the REST of the setup for a single-player text adventure, from its Premise alone.",
        `Reply with a single JSON object and nothing else — no prose, no commentary, no code fences. It has exactly these keys: "title", "startLocation", "tone", "physicalLogic", "dangerCurve", "factions", "openingNarration".`,
        "",
        "THE FIELDS",
        SCENARIO_BUNDLE_RULES,
        "",
        "RULES",
        "- Every field must agree with the Premise below and with each other.",
        "- Write all seven fields. Do not omit any.",
      ].join("\n"),
    },
    { role: "system", content: `PREMISE\n${premise}` },
  ];

  const player = playerBlock(game, characters);
  if (player) messages.push({ role: "system", content: player });

  const notes = formatWorldNotesBlock(matchWorldNotes(game.worldNotes, premise));
  if (notes) messages.push({ role: "system", content: notes });

  messages.push({
    role: "user",
    content: "Write the rest of the world seed from this Premise. Emit the JSON object now.",
  });

  return messages;
}

/**
 * Pull the bundle out of a model reply. Tolerant per-field, like every other
 * parser here: a missing or malformed field is simply absent from the result
 * rather than failing the whole call, so a model that forgets "title" still
 * hands back six usable fields instead of none.
 */
export function parseGeneratedScenarioBundle(raw: string): Partial<Scenario> | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return null;

  const result: Partial<Scenario> = {};

  if (typeof parsed.title === "string" && parsed.title.trim()) result.title = parsed.title.trim();
  if (typeof parsed.startLocation === "string" && parsed.startLocation.trim())
    result.startLocation = parsed.startLocation.trim();
  if (typeof parsed.openingNarration === "string" && parsed.openingNarration.trim())
    result.openingNarration = parsed.openingNarration.trim();

  const stringList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
      : [];

  const tone = stringList(parsed.tone);
  if (tone.length) result.tone = tone;
  const physicalLogic = stringList(parsed.physicalLogic);
  if (physicalLogic.length) result.physicalLogic = physicalLogic;
  const dangerCurve = stringList(parsed.dangerCurve);
  if (dangerCurve.length) result.dangerCurve = dangerCurve;

  if (Array.isArray(parsed.factions)) {
    const factions = parsed.factions
      .map((f): Faction | null => {
        if (!f || typeof f !== "object") return null;
        const row = f as Record<string, unknown>;
        const name = typeof row.name === "string" ? row.name.trim() : "";
        if (!name) return null;
        return {
          name,
          description: typeof row.description === "string" ? row.description.trim() : "",
        };
      })
      .filter((f): f is Faction => f !== null)
      .slice(0, BUNDLE_FACTION_COUNT);
    if (factions.length) result.factions = factions;
  }

  return Object.keys(result).length ? result : null;
}
