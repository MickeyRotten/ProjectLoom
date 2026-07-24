import type { Character, GameState, Item, Scenario, Settings } from "../types";

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

/** Max party members alongside the PC (PC + 3). */
export const PARTY_LIMIT = 3;

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

export const DEFAULT_PORTRAIT_ACTION = `The pose is perfectly neutral and still: arms relaxed at the sides, shoulders square to the camera, head level, mouth closed, eyes open, with a calm, expressionless face.`;

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

export const DEFAULT_SPOTLIGHT_RULE = `Give the spotlight to at most one party member per turn, and only when it earns a moment: they were directly addressed, their Field Skill is relevant, or they have been silent for a while. Otherwise keep them quiet.`;

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
    portraitAction: DEFAULT_PORTRAIT_ACTION,
    portraitContext: DEFAULT_PORTRAIT_CONTEXT,
    portraitComposition: DEFAULT_PORTRAIT_COMPOSITION,
    portraitStyle: DEFAULT_PORTRAIT_STYLE,
    portraitRefImages: [],
    portraitRefInstruction: DEFAULT_REFERENCE_INSTRUCTION,
    ditherMode: "bayer4",
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
    likes: "Adventure, food, boobs, butts, excitement.",
    dislikes: "Boredom, jerks, bullies, alcohol, being told what to do.",
    fieldSkill: {
      name: "Superhuman Strength",
      description: "Can lift incredibly heavy objects with ease, punch through walls and brittle stone, and take hits that would kill a normal person.",
    },
    equipment: [
      { label: "White Tunic", description: "Old, tattered, but still serviceable." },
      { label: "Black Trousers", description: "Simple, worn, baggy trousers." },
      { label: "Leather Satchel", description: "Worn leather satchel for carrying supplies." },
    ],
    lastSpokeTurn: 0,
    inParty: false,
    useCustomPortraitPrompt: false,
    customPortraitPrompt: "",
  };
}

/** A blank in-party member for manual authoring (Characters screen, Phase 4). */
export function newMember(id: string): Character {
  return {
    id,
    role: "member",
    name: "",
    species: "human",
    description: "",
    personality: "",
    drive: "",
    likes: "",
    dislikes: "",
    fieldSkill: { name: "", description: "" },
    equipment: [],
    lastSpokeTurn: 0,
    inParty: true,
    useCustomPortraitPrompt: false,
    customPortraitPrompt: "",
  };
}

/**
 * A fresh active game seeded from the editable scenario + roster. When a
 * roster is passed (New Adventure), the authored PC and members carry over
 * with per-run state (lastSpokeTurn) reset; without one, the default PC seeds.
 */
export function newGame(
  scenario: Scenario = DEFAULT_SCENARIO,
  characters?: Character[],
): GameState {
  return {
    scenario,
    characters: characters?.length
      ? characters.map((c) => ({ ...c, lastSpokeTurn: 0 }))
      : [defaultPC()],
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
 * Merge a stored game over a fresh skeleton so saves written by older app
 * versions (missing later-phase slices like worldNotes/quests) load without
 * crashing the turn builder. Mirrors loadSettings' merge-over-defaults.
 */
export function migrateGame(saved: unknown): GameState | null {
  if (!saved || typeof saved !== "object") return null;
  const base = newGame();
  const partial = saved as Partial<GameState>;
  return {
    ...base,
    ...partial,
    scenario: { ...base.scenario, ...(partial.scenario ?? {}) },
    // Saves from before Gold existed gain the permanent currency row.
    inventory: ensureGold(partial.inventory ?? []),
  };
}
