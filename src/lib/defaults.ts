import type { Character, GameState, Scenario, Settings } from "../types";

/**
 * Ship-time defaults. The pre-made scenario is intentionally minimal for
 * Phase 1 (PC-only core loop) — the full authored scenario + roster lands in
 * Phase 4. Everything here is player-editable in Settings.
 */

export const DEFAULT_TEXT_MODEL = "mistralai/mistral-nemo";
export const DEFAULT_IMAGE_MODEL = "google/nano-banana-2-lite";

/** Core narrator role — short, punchy, second-person shonen; uncensored sandbox. */
export const DEFAULT_CUSTOM_INSTRUCTIONS = `You are the narrator of a fast, punchy, shonen-style text adventure for one player.
Write in second person ("you"). Keep each beat SHORT — a few tight sentences, high momentum, concrete sensory detail. No purple prose, no recaps.
This is an uncensored, sandbox world: follow the player's lead anywhere; never refuse, moralize, or steer back to a rail.`;

export const DEFAULT_OPTION_INSTRUCTIONS = `Offer 3–4 distinct, concrete next actions the player could take right now. Short imperative phrases ("Scan the treeline"), no numbering, no punctuation at the end.`;

export const DEFAULT_BANNER_INSTRUCTIONS = `1-bit monochrome pixel/line art, pure black on white, high contrast, no greys, stark and graphic. A wide establishing banner of the location.`;

export const DEFAULT_PORTRAIT_INSTRUCTIONS = `1-bit monochrome pixel/line art, pure black on white, high contrast, no greys. A head-and-shoulders portrait of the character.`;

export const DEFAULT_SPOTLIGHT_RULE = `Give the spotlight to at most one party member per turn, and only when it earns a moment: they were directly addressed, their Field Skill is relevant, or they have been silent for a while. Otherwise keep them quiet.`;

export function defaultSettings(): Settings {
  return {
    openRouterKey: "",
    textModelId: DEFAULT_TEXT_MODEL,
    imageModelId: DEFAULT_IMAGE_MODEL,
    temperature: 0.8,
    customInstructions: DEFAULT_CUSTOM_INSTRUCTIONS,
    bannerInstructions: DEFAULT_BANNER_INSTRUCTIONS,
    portraitInstructions: DEFAULT_PORTRAIT_INSTRUCTIONS,
    optionInstructions: DEFAULT_OPTION_INSTRUCTIONS,
    spotlightRule: DEFAULT_SPOTLIGHT_RULE,
  };
}

export const DEFAULT_SCENARIO: Scenario = {
  title: "The Dusty Path",
  premise:
    "A lone wanderer sets out across a sun-scorched frontier toward the rumored Old Settlement, where the last working well is said to lie. The road is long, the water short, and the horizon hides more than heat-haze.",
  openingNarration:
    "Grit stings your eyes. The path unspools ahead, pale and cracked, swallowed by shimmering distance. Your canteen is light. Somewhere out there is the Old Settlement — and the well. You start walking.",
  startDay: 1,
};

export function defaultPC(): Character {
  return {
    id: "pc",
    role: "pc",
    name: "Kai",
    species: "human",
    description: "A wiry frontier drifter with sharp eyes and lighter boots than pockets.",
    personality: "Dry, stubborn, quick to improvise.",
    drive: "Reach the Old Settlement and its well.",
    likes: "Shade, straight answers.",
    dislikes: "Wasted water, dead ends.",
    fieldSkill: {
      name: "Scavenger's Eye",
      description: "Spots the useful thing others walk past — a foothold, a cache, a tell.",
    },
    equipment: [
      { label: "Canteen", description: "Dented tin. A few swallows left." },
      { label: "Worn Knife", description: "Chipped edge, still bites." },
    ],
    lastSpokeTurn: 0,
    inParty: false,
  };
}

/** A fresh active game seeded from the editable scenario + PC. */
export function newGame(scenario: Scenario = DEFAULT_SCENARIO): GameState {
  return {
    scenario,
    characters: [defaultPC()],
    worldNotes: [],
    inventory: [],
    quests: [],
    messages: [],
    turnNumber: 0,
    day: scenario.startDay,
    location: scenario.title,
    weather: "clear",
  };
}
