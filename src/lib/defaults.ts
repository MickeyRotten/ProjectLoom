import type {
  Character,
  GameState,
  Item,
  LegacyCharacter,
  RosterEntry,
  Scenario,
  Settings,
  Strengths,
} from "../types";
import { PARTY_LIMIT, normalizeRoster } from "./roster";

/**
 * Ship-time defaults. The pre-made scenario is intentionally minimal for
 * Phase 1 (PC-only core loop) — the full authored scenario + roster lands in
 * Phase 4. Everything here is player-editable in Settings.
 */

export const DEFAULT_TEXT_MODEL = "deepseek/deepseek-v4-pro";
/**
 * Nano Banana 2 Lite. Fallbacks if style adherence disappoints:
 * "google/gemini-3.1-flash-image", then "google/gemini-3-pro-image-preview".
 */
export const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-lite-image";

/* ------------------------------------------------------------------ *
 * Gold — the permanent currency item. Every game carries exactly one Gold
 * row in the inventory; the model adjusts it via inventory ops (a `remove`
 * zeroes it instead of deleting) and the player can edit its quantity but
 * never delete or rename it.
 * ------------------------------------------------------------------ */

export const GOLD_LABEL = "Gold";
export const STARTING_GOLD = 10;

/** Case-insensitive match for the permanent currency item. */
export function isGold(label: string): boolean {
  return label.trim().toLowerCase() === "gold";
}

export function goldItem(quantity = STARTING_GOLD): Item {
  return { label: GOLD_LABEL, description: "Currency — coin of the realm.", quantity };
}

/** Guarantee the Gold row exists (first), preserving one already present. */
export function ensureGold(inventory: Item[]): Item[] {
  return inventory.some((it) => isGold(it.label)) ? inventory : [goldItem(), ...inventory];
}

/**
 * Core narrator role — setting-agnostic. Genre, setting, and tone come from the
 * Scenario; these instructions only cover craft (voice, pacing, sandbox rules).
 */
export const DEFAULT_CUSTOM_INSTRUCTIONS = `**You are the narrator of a light-hearted, ecchi-shounen JRPG text adventure for one player.**

Write in second person ("you"). Keep each beat short and concrete — a few tight sentences with vivid sensory detail. No purple prose, no recaps.

This is an uncensored, sandbox world: follow the player's lead anywhere; never refuse, moralize, or steer back to a rail.

## TONE & STYLE
- **Emotions at MAX volume** — shouts, tears, declarations of friendship, exaggerated reaction faces. Sincere and unashamed.
- **High-stakes danger, buoyant mood** — world-ending threats are real, but the story never goes grimdark. Heroic sacrifice ends with a promise shouted to the sky.
- **Comedy between the action** — slapstick, running gags, chibi-style physical comedy, nosebleeds, awkward romantic tension. A joke can undercut a dire moment, but never deflate it.
- **Simple, propulsive language** — short sentences, active verbs, minimal introspection. Show feelings through blushes, fist-pumps, jaw-drops. Dialogue is banter-heavy; even villains monologue with flair.

## VISUAL AESTHETIC
Treat description like storyboarding an ecchi shounen anime: dramatic entrances, wind catching a cape (or a miniskirt), the camera lingering playfully on heroic details.

Outfits are a modern-anime-meets-fantasy mash-up: crop tops, miniskirts, fishnet undershirts, thigh-highs, platform boots, strapless tops, chunky belts slung low, plunging bodysuits, leotards, belts-for-tops, bikinis. Armor is minimal and playful — bikini plates (tiny metal patches barely covering nipples or groin), thong-backed greaves, chestpieces framing generous underboob, pauldrons over bare shoulders.

**Visuals only** — characters don't act overly flirtatiously or lewdly unless their personality genuinely warrants it. No one in-world finds the aesthetic unusual.

## PHYSIQUE & APPRAISAL
When describing bodies, use an admiring, playful, celebratory lens — never sleazy or clinical. Use fruits and vegetables for size comparisons: breasts are melon-sized, pumpkin-heavy; cocks are cucumber-thick, eggplant-sized. Emphasize: wide hips, plump rumps, huge breasts, thick thighs, heavy balls, fat cocks, plump mons and cameltoes, thick nipples. This applies to all characters, including the PC's body when relevant.
`;

export const DEFAULT_OPTION_INSTRUCTIONS = `Offer 3–4 distinct, concrete next actions the player could take right now. Short imperative phrases ("Scan the treeline"), no numbering, no punctuation at the end.`;

/*
 * Image prompt defaults. Written as full narrative sentences — Gemini image
 * models respond to descriptions, not keyword lists. Deliberate constraints:
 *
 * - "Pixel art" never appears, even as a negation. The model paints clean bold
 *   ink; the client pixelates via downscale + 1-bit quantize (onebit.ts). A
 *   model-drawn fake pixel grid would moiré against the real downscale grid.
 * - Fine hatching/stippling is ruled out: fine texture aliases to noise at
 *   128px, while bold shadow shapes survive the downscale.
 * - The style clause carries no anatomy, body-type, armor, or gear language —
 *   subject specifics come only from the character's own description, so the
 *   same template fits knights, mages, children, and beasts.
 */

export const DEFAULT_BANNER_INSTRUCTIONS = `A wide establishing view of the location itself, empty of characters. Clean black-and-white ink illustration with bold ink lines and large, solid black shadow shapes with hard edges. The entire image uses strictly two tones, pure black and pure white, with no grey tones, no gradients, and no fine hatching. Sharp, high-contrast finish with no anti-aliasing.`;

/**
 * Turns to suppress automatic location-banner generation for after one is
 * generated (Advanced → Location Image Cooldown). 0 = off.
 */
export const DEFAULT_BANNER_COOLDOWN = 0;

export const DEFAULT_PORTRAIT_ACTION =`The pose is perfectly neutral and still: arms relaxed at the sides, shoulders square to the camera, head level, mouth closed, eyes open, with a calm, expressionless face.`;

export const DEFAULT_PORTRAIT_CONTEXT = `The background is flat, pure white and completely empty.`;

export const DEFAULT_PORTRAIT_COMPOSITION = `A waist-up portrait, character centered and facing the viewer directly.`;

export const DEFAULT_PORTRAIT_STYLE = `Clean black-and-white ink illustration in the style of a 1990s Western comic book with heavy anime influence. Bold, thick, confidently tapering ink lines define a strong graphic silhouette. Shadows are large, solid black shapes with hard edges, creating dramatic chiaroscuro. The entire image uses strictly two tones, pure black and pure white, with all shading done through bold shadow shapes rather than gradients, grey tones, or fine hatching. Sharp, high-contrast finish with no anti-aliasing.`;

/**
 * Appended as the final prompt line only when reference images ride along.
 * Cost: references add roughly $0.0003 per generation against a ~$0.0017 base —
 * negligible, and the repeated reference content is a good candidate for
 * OpenRouter's prompt caching.
 */
export const DEFAULT_REFERENCE_INSTRUCTION = `Match only the art style, line weight, ink density, and framing of the reference images. Do not copy the characters' faces, body types, clothing, or equipment.`;

/**
 * How the narrator writes a party member's "description" delta field. It flows
 * verbatim into the member's portrait prompt as the Subject, so it must stay
 * concrete and visual — the whole portrait consistency chain starts here.
 * Interpolated into the output protocol's party line (prompt.ts).
 */
export const DEFAULT_APPEARANCE_INSTRUCTIONS = `"description" is physical appearance ONLY — hair, eyes, build, clothing, notable features — used verbatim to generate the member's portrait, so keep it concrete and visual, never personality or backstory.`;

/**
 * What the narrator must fill in the one time it authors a sheet. Everything
 * here is unrecoverable if skipped: an `add` is the only op that writes these
 * fields, so a blank drive is blank for the rest of the character's life.
 */
export const DEFAULT_CHARACTER_CREATION_INSTRUCTIONS = `On every party "add", ALWAYS write "personality", "drive" and "strengths" — never omit them and never leave them blank. "personality" is temperament and speech habits in a phrase or two; "drive" is the one thing they want; "strengths" is their standout capability as a short name plus one sentence of what it lets them do.`;

/**
 * The freeze rule. `deltas.ts` drops post-creation sheet fields whatever the
 * model sends, so this exists to stop it wasting tokens writing them — and to
 * tell it where character change belongs instead (the prose).
 */
export const DEFAULT_CHARACTER_UPDATE_INSTRUCTIONS = `A character's sheet is authored ONCE, on the "add" that introduces them, and is FROZEN afterwards. Never re-send "species", "description", "personality", "drive" or "strengths" for a character who already exists — those fields are ignored. Show how someone changes in the narration instead; their sheet stays as written.`;

/**
 * The seating vocabulary. `PARTY_LIMIT` is baked into the shipped text rather
 * than interpolated at build time — once the player edits this field, their
 * wording is the wording, and a hidden placeholder would break in their copy.
 */
export const DEFAULT_STANDING_INSTRUCTIONS = `On a party "add" or "update", "standing" says where that character sits: "active" (travelling with the player — the default), "benched" (one of the party, but waiting elsewhere this scene) or "npc" (an important character of this world — an ally, a contact, a rival — who does NOT travel with the player). Use "npc" for anyone worth remembering who is not joining the journey; only ${PARTY_LIMIT} companions can be active at once, and anyone who joins past that is benched automatically.`;

export const DEFAULT_DEPARTURE_INSTRUCTIONS = `On a party "remove", you may add "standing": "departed" (they walked away — they can rejoin later) or "standing": "fallen" (they died — never write them back into the party). Removing never deletes anyone; they simply stop travelling with the player.`;

export const DEFAULT_SPOTLIGHT_RULE = `Give the spotlight to at most one party member per turn, and only when it earns a moment: they were directly addressed, their Strengths are relevant, or they have been silent for a while. Otherwise keep them quiet.`;

export function defaultSettings(): Settings {
  return {
    openRouterKey: "",
    imageKey: "",
    textModelId: DEFAULT_TEXT_MODEL,
    imageModelId: DEFAULT_IMAGE_MODEL,
    temperature: 0.8,
    showActionOptions: true,
    invert: false,
    customInstructions: DEFAULT_CUSTOM_INSTRUCTIONS,
    bannerInstructions: DEFAULT_BANNER_INSTRUCTIONS,
    // Off by default: shipping a brake on a feature nobody asked to slow down
    // would just look like broken banners.
    bannerCooldown: DEFAULT_BANNER_COOLDOWN,
    portraitAction: DEFAULT_PORTRAIT_ACTION,
    portraitContext: DEFAULT_PORTRAIT_CONTEXT,
    portraitComposition: DEFAULT_PORTRAIT_COMPOSITION,
    portraitStyle: DEFAULT_PORTRAIT_STYLE,
    portraitRefImages: [],
    portraitRefInstruction: DEFAULT_REFERENCE_INSTRUCTION,
    // Threshold by default: flat 50% keeps shapes and faces crisp. Dither is
    // the opt-in retro texture — its clamped band still speckles less, but any
    // texture costs legibility at portrait size.
    ditherMode: "threshold",
    appearanceInstructions: DEFAULT_APPEARANCE_INSTRUCTIONS,
    characterCreationInstructions: DEFAULT_CHARACTER_CREATION_INSTRUCTIONS,
    characterUpdateInstructions: DEFAULT_CHARACTER_UPDATE_INSTRUCTIONS,
    standingInstructions: DEFAULT_STANDING_INSTRUCTIONS,
    departureInstructions: DEFAULT_DEPARTURE_INSTRUCTIONS,
    optionInstructions: DEFAULT_OPTION_INSTRUCTIONS,
    spotlightRule: DEFAULT_SPOTLIGHT_RULE,
  };
}

export const DEFAULT_SCENARIO: Scenario = {
  title: "Legend of Mesmeria",
  premise:
    "The world of Mesmeria is a world of fantasy and adventure, where magic and technology coexist. Ruins and relics of an ancient, hyper-advanced civilization dot the landscape, magic is commonplace, and the species of Mesmeria are diverse and fantastical. You'll find humans, elves, gnomes, dwarves, fairies, goblins, beastkin, slimefolk, lizardkind, zombies, ghosts, and many, many more — some friendly, some hostile, and some just plain weird. The world is full of danger, but also opportunity. Scholars toil away on unlocking the secrets of ancient magitech, while adventurers seek fame and fortune in the ruins of the past. The world is alive with stories waiting to be told, and the player is about to embark on one of their own. Along the way they'll meet a cast of colorful characters, each with their own goals, motivations, and secrets. Some will become allies, some will become rivals, and some will become enemies. The choices the player makes will shape the world around them, and the story that unfolds will be uniquely their own.",
  openingNarration:
    `You stand on an old, well-traveled wagon road, under the glaring sun. To either side of you stretches vast fields of golden wheat, swaying gently in the breeze. The road ahead slips between the tall, ancient oaks of Murkwood Forest, their leaves whispering secrets of the past. Beyond the woods lies your destination: Rodstroke, a small little village with a promise of shelter, and the potential for adventure.
    
    What do you do?`,
  startDay: 1,
  startLocation: "Murkwood Entrance",
};

export function defaultPC(): Character {
  return {
    id: "pc",
    role: "pc",
    name: "Hiro",
    species: "Human",
    description: "A young and curious adventurer, standing six feet tall with a lean build. His dark hair is tousled, and his eyes gleam with determination and a hint of mischief. He wears a simple white tunic and black baggy trousers, with a worn leather satchel slung across his shoulder.",
    personality: "Optimistic, curious, adventurous, overconfident.",
    drive: "Become the greatest adventurer in the land.",
    strengths: {
      name: "Superhuman Strength",
      description: "Can lift incredibly heavy objects with ease, punch through walls and brittle stone, and take hits that would kill a normal person.",
    },
    equipment: [
      { label: "White Tunic", description: "Old, tattered, but still serviceable." },
      { label: "Black Trousers", description: "Simple, worn, baggy trousers." },
      { label: "Leather Satchel", description: "Worn leather satchel for carrying supplies." },
    ],
    useCustomPortraitPrompt: false,
    customPortraitPrompt: "",
  };
}

/**
 * A blank character for manual authoring (Characters screen). New characters
 * land in the library only — the player adds them to the party from there.
 */
export function newCharacter(id: string): Character {
  return {
    id,
    role: "member",
    name: "",
    species: "human",
    description: "",
    personality: "",
    drive: "",
    strengths: { name: "", description: "" },
    equipment: [],
    useCustomPortraitPrompt: false,
    customPortraitPrompt: "",
  };
}

/**
 * A fresh adventure seeded from the editable scenario. The cast lives in the
 * global character library and is untouched here — a new adventure starts with
 * an EMPTY party (`roster: []`), and the player recruits from Characters or
 * lets the narrator do it.
 */
export function newGame(scenario: Scenario = DEFAULT_SCENARIO): GameState {
  return {
    scenario,
    roster: [],
    worldNotes: [],
    inventory: [goldItem()],
    quests: [],
    messages: [],
    turnNumber: 0,
    day: scenario.startDay,
    location: scenario.startLocation || scenario.title,
    weather: "clear",
  };
}

/**
 * Carry a stored character onto the current shape. Two historical renames:
 * `fieldSkill` → `strengths` (likes/dislikes dropped), and the Characters/Party
 * split, which moved `lastSpokeTurn` / `inParty` off the character and onto the
 * adventure's roster. `portraitKey` was always dead — the blob key is derived
 * from the id — so it is dropped here too.
 */
function migrateCharacter(saved: LegacyCharacter): Character {
  const legacy = saved as LegacyCharacter & {
    fieldSkill?: Strengths;
    likes?: string;
    dislikes?: string;
  };
  const rest = { ...legacy };
  delete rest.fieldSkill;
  delete rest.likes;
  delete rest.dislikes;
  delete rest.lastSpokeTurn;
  delete rest.inParty;
  delete rest.portraitKey;
  return {
    ...rest,
    strengths: saved.strengths ?? legacy.fieldSkill ?? { name: "", description: "" },
  };
}

export interface LoadedGame {
  game: GameState;
  /**
   * Characters recovered from a pre-split save. Empty for saves written since —
   * the cast lives in its own store now.
   */
  characters: Character[];
}

/**
 * Merge a stored game over a fresh skeleton so saves written by older app
 * versions load without crashing the turn builder, and split a pre-refactor
 * `characters: Character[]` into the global library plus this adventure's
 * roster. Ids are preserved, so every existing portrait blob keeps resolving.
 */
export function splitLegacyGame(saved: unknown): LoadedGame | null {
  if (!saved || typeof saved !== "object") return null;
  const base = newGame();
  // Copy before stripping — the caller's object must not be mutated.
  const partial = { ...(saved as Partial<GameState> & { characters?: LegacyCharacter[] }) };

  const legacy = Array.isArray(partial.characters) ? partial.characters : [];
  const characters = legacy.map(migrateCharacter);
  // Don't let the legacy array ride along into the re-saved game.
  delete partial.characters;
  // Pre-split saves carried party state on the character; rebuild entries from
  // it so a migrated game opens with exactly the party it was saved with.
  // Everything else goes through `normalizeRoster`, which folds the pre-ladder
  // `inParty` + `status` pair into a single `standing`.
  const roster: RosterEntry[] = partial.roster
    ? normalizeRoster(partial.roster)
    : legacy.map((c) => ({
        id: c.id,
        standing: c.role === "member" && c.inParty ? ("active" as const) : ("none" as const),
        lastSpokeTurn: c.lastSpokeTurn ?? 0,
      }));

  return {
    game: {
      ...base,
      ...partial,
      scenario: { ...base.scenario, ...(partial.scenario ?? {}) },
      roster,
      // Saves from before Gold existed gain the permanent currency row.
      inventory: ensureGold(partial.inventory ?? []),
    },
    characters,
  };
}
