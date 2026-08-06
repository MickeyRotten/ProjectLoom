import type {
  AdventureImports,
  Character,
  GameState,
  Item,
  LegacyCharacter,
  LegacyStrengths,
  QuickAction,
  RosterEntry,
  Scenario,
  Settings,
} from "../types";
import { MORNING_ANCHOR, normalizeMinutes } from "./clock";
import { normalizePlaces } from "./places";
import { PARTY_LIMIT, normalizeRoster, strengthsText } from "./roster";
import { SCENE_TILT } from "./diceAnim";
import { DEFAULT_DICE, RISK_KEYWORDS } from "./stakes";
import { DEFAULT_COMFY } from "./comfyui";
import { builtinTemplates, PROSE_TEMPLATE_ID } from "./imageTemplates";

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

/**
 * How many composer shortcuts there are. Fixed rather than a list the player
 * grows: the row is three buttons wide on a phone, and a fourth would either
 * shrink them below a comfortable tap or wrap.
 */
export const QUICK_ACTION_COUNT = 3;

/** The shipped shortcuts — what the row was hardcoded to before it was editable. */
export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { label: "Look", input: "I look around." },
  { label: "Wait", input: "I wait to see what happens." },
  { label: "Investigate", input: "I investigate my immediate surroundings carefully." },
];

export const DEFAULT_OPTION_INSTRUCTIONS =`Offer 3–4 distinct, concrete next actions the player could take right now. Short imperative phrases ("Scan the treeline"), no numbering, no punctuation at the end.`;

/**
 * What the narrator must fill in the one time it authors a sheet. Everything
 * here is unrecoverable if skipped: an `add` is the only op that writes these
 * fields, so a blank drive is blank for the rest of the character's life.
 */
export const DEFAULT_CHARACTER_CREATION_INSTRUCTIONS = `On every party "add", ALWAYS write "sex", "personality", "drive", "strengths", "flaws" and "equipment" — never omit them and never leave them blank. "sex" is their sex or gender in a word, whatever the setting's vocabulary is — the pronouns you use for them from now on. "personality" is temperament and speech habits in a phrase or two; "drive" is the one thing they want; "strengths" is what they are good at in a sentence or two; "flaws" is what they are bad at, in the same breath. "equipment" is the gear they carry RIGHT NOW, read straight off the appearance you just wrote — every garment, weapon, and tool you described, each as { "label", "description" }. Never leave out something visible in the description, and never add gear nobody can see.`;

/**
 * The naming rule — both halves of the same problem. A narrator asked to add
 * "a character who enters the player's story" adds one the moment a goblin
 * swings a club, before anybody has a name for it; when the name lands two
 * beats later it has no way to say *that was this person*, so it emits a
 * second `add` and the party holds "Unnamed Goblin" and "Grik" side by side.
 * The first sentence stops most of it (a character with no name is prose, not
 * a party op); the rename is what covers the rest, since an alias revealed as
 * a real name is the same event and no naming discipline can prevent it.
 */
export const DEFAULT_NAMING_INSTRUCTIONS = `Only add a character to "party" once the player has something to CALL them — a name, an alias, or the title they are known by ("the Hooded Stranger", "the Ferryman" are all fine; "Unnamed Goblin", "Unknown Woman", "Mysterious Figure" are not). Someone nameless is prose: write them in the narration and add them the turn they are named. When a character you already added is given a new name — they introduce themselves, an alias turns out to be false, the player learns who they really are — RENAME them: { "op": "update", "name": "<what you called them before>", "newName": "<what you call them now>" }. NEVER add a second character for somebody who already exists under another name.`;

/**
 * The freeze rule. `deltas.ts` drops post-creation sheet fields whatever the
 * model sends, so this exists to stop it wasting tokens writing them — and to
 * tell it where character change belongs instead (the prose).
 */
export const DEFAULT_CHARACTER_UPDATE_INSTRUCTIONS = `A character's sheet is authored ONCE, on the "add" that introduces them, and is FROZEN afterwards. Never re-send "species", "sex", "description", "personality", "drive", "strengths", "flaws" or "equipment" for a character who already exists — those fields are ignored, and their gear is the player's to change. Show how someone changes in the narration instead; their sheet stays as written.`;

/**
 * The seating vocabulary. `PARTY_LIMIT` is baked into the shipped text rather
 * than interpolated at build time — once the player edits this field, their
 * wording is the wording, and a hidden placeholder would break in their copy.
 */
export const DEFAULT_STANDING_INSTRUCTIONS = `On a party "add" or "update", "standing" says where that character sits: "active" (travelling with the player — the default), "benched" (one of the party, but waiting elsewhere this scene) or "npc" (an important character of this world — an ally, a contact, a rival — who does NOT travel with the player). Use "npc" for anyone worth remembering who is not joining the journey; only ${PARTY_LIMIT} companions can be active at once, and anyone who joins past that is benched automatically.`;

export const DEFAULT_DEPARTURE_INSTRUCTIONS = `On a party "remove", you may add "standing": "departed" (they walked away — they can rejoin later) or "standing": "fallen" (they died — never write them back into the party). Removing never deletes anyone; they simply stop travelling with the player.`;

export const DEFAULT_SPOTLIGHT_RULE = `Give the spotlight to at most one party member per turn, and only when it earns a moment: they were directly addressed, their Strengths are relevant, or they have been silent for a while. Otherwise keep them quiet.`;

/**
 * What the narrator does with the outcome band `stakes.ts` hands it. The roll
 * itself is not editable — that is the mechanic — but what STRONG / MIXED /
 * COST *mean* in this world is exactly the kind of thing a scenario should get
 * to redefine, so it lives here as one editable block.
 *
 * The last line is load-bearing: a shonen adventure ends with the hero bloodied
 * and shouting, not dead, and a narrator handed a bare "COST" will otherwise
 * eventually kill the player and strand the save.
 */
export const DEFAULT_STAKES_RULE = `STRONG — it works. Give the player a clean, satisfying win and let them feel it.
MIXED — it works, but it costs: a complication lands, something breaks, a resource is spent, or the win draws attention. Never a flat success.
COST — it goes wrong. The player pays something real — hurt, disarmed, separated, caught out, or robbed of the moment. Follow through; do not rescue them from it on the same beat.
When a result marks someone lastingly, record it in "conditions". Never kill the player character: leave them alive with something to fix.`;

/**
 * The risk-word list as an editable field (RPG System → Risky Actions). Written
 * out of `RISK_KEYWORDS` so the shipped list and the default text can never
 * drift apart; the player edits a comma-separated line, `parseKeywords` reads it
 * back.
 */
export const DEFAULT_RISK_KEYWORDS = RISK_KEYWORDS.join(", ");

/**
 * Rolling-history budget, in approximate tokens. 3000 was hardcoded and never
 * passed by the store, which capped a campaign at roughly 15–25 turns before
 * the early game fell out of memory for good. It ships unchanged so existing
 * saves behave identically, but it is a field now — the narrator's own World
 * Notes carry the long tail, and a large-context model can afford far more.
 */
export const DEFAULT_HISTORY_BUDGET_SETTING = 3000;

/**
 * Cap on one beat's length. Beats are meant to be "short and punchy", which was
 * only ever a sentence in the prompt — with no `max_tokens` the model's default
 * decided. 0 sends no cap.
 */
export const DEFAULT_MAX_TOKENS = 700;

/**
 * Journal defaults. The budget is deliberately a fraction of the history one:
 * entries are terse lists, and the block's job is continuity over the recent
 * stretch, not permanent recall — anything from Day 12 that still matters
 * should already be a World Note, a quest or a condition.
 */
export const DEFAULT_JOURNAL_BUDGET = 600;

/** Turns after which an entry is written even though nobody has slept. */
export const DEFAULT_JOURNAL_MAX_TURNS = 30;

/** Turns an interval must reach to earn its own entry. */
export const DEFAULT_JOURNAL_MIN_TURNS = 4;

/**
 * What a journal line is. Player-editable, and phrased for a model that has the
 * beats plus the already-extracted factual lines in front of it — its job is
 * the half the deltas could not see.
 */
export const DEFAULT_JOURNAL_INSTRUCTIONS = `Write what happened to the player character, as a short list of terse past-tense lines — a ship's log, not a diary. One event per line, under twelve words, no adjectives you can spare.
Only write what the beats show happening. Do not restate who the player is, what they carry, who travels with them, or what quests are open — all of that is in front of you every turn already.
Skip anything the FACTS list below has already recorded.`;

/**
 * Thinking effort for the text model. `auto` ships because it is the only value
 * that changes nothing: no `reasoning` field is sent, so every model — reasoning
 * or not — behaves exactly as it did before the setting existed.
 */
export const DEFAULT_REASONING_LEVEL = "auto" as const;

/**
 * The shipped colors — the stark reading of 1-bit, ink glyphs on paper. They
 * are the fallback for every unreadable stored value, so they must be a pair
 * anyone can see: black on white, maximum contrast, no assumptions.
 */
export const DEFAULT_PAPER = "#ffffff";
export const DEFAULT_INK = "#000000";

/**
 * Shipped reading size, in pixels. 16 is what the old `textScale: "m"` resolved
 * to through Tailwind's `text-base`, so the setting means the same thing across
 * the change.
 */
export const DEFAULT_TEXT_SIZE = 16;

export function defaultSettings(): Settings {
  return {
    openRouterKey: "",
    setupDone: false,
    imageKey: "",
    // Cloud sync is opt-in: an app that has never asked for an account must not
    // start talking to one, and the offline single-device game is still the
    // shipped experience.
    syncEnabled: false,
    // Blank means "use whatever the build was given" — see `Settings`.
    supabaseUrl: "",
    supabaseAnonKey: "",
    textModelId: DEFAULT_TEXT_MODEL,
    imageModelId: DEFAULT_IMAGE_MODEL,
    // On by default — portraits have always drawn themselves, and shipping the
    // switch OFF would read as the image pipeline having broken. Location
    // images stay separately opt-in below.
    imagesEnabled: true,
    // OpenRouter, plus an unconfigured ComfyUI sitting behind it — the whole
    // group from `comfyui.ts`, so "the default ComfyUI setup" is defined once.
    ...DEFAULT_COMFY,
    temperature: 0.8,
    reasoningLevel: DEFAULT_REASONING_LEVEL,
    showActionOptions: true,
    // On, because it costs nothing on a model that follows the contract — it
    // fires only when a turn arrives with no block and no salvageable options.
    repairBlock: true,
    quickActions: DEFAULT_QUICK_ACTIONS.map((a) => ({ ...a })),
    paper: DEFAULT_PAPER,
    ink: DEFAULT_INK,
    textSize: DEFAULT_TEXT_SIZE,
    font: "system",
    webFonts: [],
    customInstructions: DEFAULT_CUSTOM_INSTRUCTIONS,
    // Both shipped dialects, with the prose one selected — it is what every
    // image prompt looked like before templates existed, and it is the one that
    // matches the default (OpenRouter) backend.
    imageTemplates: builtinTemplates(),
    imageTemplateId: PROSE_TEMPLATE_ID,
    portraitRefImages: [],
    // Threshold by default: flat 50% keeps shapes and faces crisp. Dither is
    // the opt-in retro texture — its clamped band still speckles less, but any
    // texture costs legibility at portrait size.
    characterCreationInstructions: DEFAULT_CHARACTER_CREATION_INSTRUCTIONS,
    namingInstructions: DEFAULT_NAMING_INSTRUCTIONS,
    characterUpdateInstructions: DEFAULT_CHARACTER_UPDATE_INSTRUCTIONS,
    standingInstructions: DEFAULT_STANDING_INSTRUCTIONS,
    departureInstructions: DEFAULT_DEPARTURE_INSTRUCTIONS,
    optionInstructions: DEFAULT_OPTION_INSTRUCTIONS,
    spotlightRule: DEFAULT_SPOTLIGHT_RULE,
    stakesEnabled: true,
    stakesRule: DEFAULT_STAKES_RULE,
    // The 1d6 system stakes.ts used to hardcode — spread so "the default rules"
    // has exactly one definition.
    ...DEFAULT_DICE,
    riskKeywords: DEFAULT_RISK_KEYWORDS,
    alwaysRoll: false,
    diceAnimation: true,
    // The shipped tilt lives with the animation it belongs to, so "the default
    // scene" has one definition (`diceAnim.ts → SCENE_TILT`).
    dicePitch: SCENE_TILT.x,
    diceYaw: SCENE_TILT.y,
    dicePerspective: true,
    historyBudget: DEFAULT_HISTORY_BUDGET_SETTING,
    maxTokens: DEFAULT_MAX_TOKENS,
    journalEnabled: true,
    journalBudget: DEFAULT_JOURNAL_BUDGET,
    journalMaxTurns: DEFAULT_JOURNAL_MAX_TURNS,
    journalMinTurns: DEFAULT_JOURNAL_MIN_TURNS,
    journalInstructions: DEFAULT_JOURNAL_INSTRUCTIONS,
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
    sex: "Male",
    description: "A young and curious adventurer, standing six feet tall with a lean build. His dark hair is tousled, and his eyes gleam with determination and a hint of mischief. He wears a simple white tunic and black baggy trousers, with a worn leather satchel slung across his shoulder.",
    personality: "Optimistic, curious, adventurous, overconfident.",
    drive: "Become the greatest adventurer in the land.",
    strengths:
      "Superhuman strength — can lift incredibly heavy objects with ease, punch through walls and brittle stone, and take hits that would kill a normal person.",
    flaws:
      "Reckless and easily distracted — charges in without a plan, and hopeless at anything needing patience, subtlety, or a straight answer.",
    notes: "",
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
    sex: "",
    description: "",
    personality: "",
    drive: "",
    strengths: "",
    flaws: "",
    notes: "",
    equipment: [],
    useCustomPortraitPrompt: false,
    customPortraitPrompt: "",
  };
}

/**
 * A fresh adventure seeded from the editable scenario. The cast is part of the
 * adventure now, so a fresh one holds exactly the PC and nobody else — the
 * party starts EMPTY (`roster: []`) and is rebuilt from Characters or by the
 * narrator recruiting during play. `newAdventure` passes the cast it was told
 * to carry over; everything else starts from `defaultPC()`.
 */
export function newGame(
  scenario: Scenario = DEFAULT_SCENARIO,
  characters: Character[] = [defaultPC()],
): GameState {
  return {
    scenario,
    characters,
    roster: [],
    worldNotes: [],
    places: [],
    inventory: [goldItem()],
    quests: [],
    messages: [],
    journal: [],
    turnNumber: 0,
    day: scenario.startDay,
    // An adventure opens in the morning — the same anchor a night's sleep wakes
    // to, so Day 1 reads like every day after it.
    minutes: MORNING_ANCHOR,
    // No area until the narrator names one, which it does on the first turn.
    // Seeding it from `startLocation` would author a Place for what is meant to
    // be a room, and the opening beat is the thing best placed to say which
    // wood or which town the road actually runs through.
    area: "",
    location: scenario.startLocation || scenario.title,
    weather: "clear",
  };
}

/**
 * Carry a stored character onto the current shape. Three historical renames:
 * `fieldSkill` → `strengths` (likes/dislikes dropped), Strengths losing its
 * `name` label to become one free-text field (`strengthsText`), and the
 * Characters/Party split, which moved `lastSpokeTurn` / `inParty` off the
 * character and onto the adventure's roster. `portraitKey` was always dead —
 * the blob key is derived from the id — so it is dropped here too. `flaws`,
 * `sex` and `notes` simply didn't exist before, and load blank.
 */
export function migrateCharacter(saved: LegacyCharacter): Character {
  const legacy = saved as LegacyCharacter & {
    fieldSkill?: string | LegacyStrengths;
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
    strengths: strengthsText(saved.strengths ?? legacy.fieldSkill),
    flaws: saved.flaws ?? "",
    notes: saved.notes ?? "",
    sex: saved.sex ?? "",
  };
}

export interface LoadedGame {
  game: GameState;
  /**
   * The stored game carried no cast of its own — it was written while the
   * library was global. `game.characters` is EMPTY in that case, which is not a
   * playable state: the caller has to supply the cast (hydrate folds in the old
   * global library; a restored slot keeps the one already in hand). Every save
   * written since carries its own cast and this is false.
   */
  legacyCast: boolean;
}

/**
 * Merge a stored game over a fresh skeleton so saves written by older app
 * versions load without crashing the turn builder, and fold its cast onto the
 * current `Character` shape. Ids are preserved, so every existing portrait blob
 * keeps resolving.
 *
 * Three cast eras arrive here: the original (characters inside the game, party
 * state on the character), the split (no characters at all — they lived in a
 * global store), and the current one (characters inside the game again, party
 * state on the roster). The first and third are told apart by whether the
 * records carry `inParty`/`lastSpokeTurn`, which only the first ever did.
 */
export function loadGame(saved: unknown): LoadedGame | null {
  if (!saved || typeof saved !== "object") return null;
  const base = newGame();
  const partial = saved as Omit<Partial<GameState>, "characters"> & {
    characters?: LegacyCharacter[];
  };

  const stored = Array.isArray(partial.characters) ? partial.characters : null;
  const characters = (stored ?? []).map(migrateCharacter);
  // Pre-split saves carried party state on the character; rebuild entries from
  // it so a migrated game opens with exactly the party it was saved with.
  // Everything else goes through `normalizeRoster`, which folds the pre-ladder
  // `inParty` + `status` pair into a single `standing`.
  const roster: RosterEntry[] = partial.roster
    ? normalizeRoster(partial.roster)
    : (stored ?? []).map((c) => ({
        id: c.id,
        standing: c.role === "member" && c.inParty ? ("active" as const) : ("none" as const),
        lastSpokeTurn: c.lastSpokeTurn ?? 0,
      }));

  return {
    game: {
      ...base,
      ...partial,
      scenario: { ...base.scenario, ...(partial.scenario ?? {}) },
      characters,
      roster,
      // Saves from before Gold existed gain the permanent currency row.
      inventory: ensureGold(partial.inventory ?? []),
      // Pre-clock saves have no time of day and open at the morning anchor;
      // their stored `day` is kept exactly as it was, since nothing recomputes
      // history. A stored value that is somehow garbage must not reach the
      // phase bands.
      minutes: normalizeMinutes(partial.minutes),
      journal: Array.isArray(partial.journal) ? partial.journal : [],
      // Sanitized on READ, like every other stored list: a save written before
      // places existed loads as none, and one hand-edited into a bad shape
      // loses the bad rows rather than the game.
      places: normalizePlaces(partial.places),
      area: typeof partial.area === "string" ? partial.area : "",
    },
    legacyCast: stored === null,
  };
}

/**
 * Guarantee the cast has a player character, prepending the shipped one when it
 * doesn't. Every screen, the prompt's PC block and the party strip assume the
 * cast holds exactly one `role: "pc"`, so a game that somehow arrives without
 * one — a hand-edited document, a stored library that only ever held
 * companions, a cast that came across from an older build — gets one rather
 * than leaving the player with no character to be.
 *
 * Returns the SAME array when a PC is already there.
 */
export function withPC(characters: Character[]): Character[] {
  return characters.some((c) => c.role === "pc") ? characters : [defaultPC(), ...characters];
}

/**
 * What the New Adventure modal opens with. The scenario and the PC were always
 * kept before this dialog existed, so they stay ticked; the cast and the world
 * notes start off, which is what "a new adventure has an empty character list
 * by default" means in practice — the supporting cast is the thing you most
 * often want to leave behind, and un-ticking is a worse default than ticking
 * when the mistake costs a whole authored world.
 */
export const DEFAULT_ADVENTURE_IMPORTS: AdventureImports = {
  scenario: true,
  pc: true,
  characters: false,
  worldNotes: false,
  // Off with the world notes, and for the same reason: an authored map is
  // setting, and setting is exactly what a new adventure may be trying to leave.
  places: false,
};

/**
 * Seed a New Adventure from the one being replaced, carrying over exactly what
 * the player ticked (`AdventureImports`).
 *
 * Pure, and deliberately the only place the rules live: "which of these four
 * things survives" is the kind of question that gets answered differently in
 * three call sites otherwise. Everything not listed — beats, journal, quests,
 * inventory, the clock — always resets; those ARE the adventure.
 */
export function seedAdventure(prev: GameState, imports: AdventureImports): GameState {
  const pc = prev.characters.find((c) => c.role === "pc");
  const cast: Character[] = [
    imports.pc && pc ? pc : defaultPC(),
    ...(imports.characters ? prev.characters.filter((c) => c.role !== "pc") : []),
  ];
  const game = newGame(imports.scenario ? prev.scenario : DEFAULT_SCENARIO, cast);
  return {
    ...game,
    // The world's NPCs carry over WITH the cast that holds them: an ally is a
    // fact about the setting, not about one run, and re-marking the supporting
    // cast by hand every new adventure is the kind of chore that doesn't get
    // done. Party standings never carry — a new adventure starts alone.
    roster: imports.characters
      ? prev.roster
          .filter((e) => e.standing === "npc" && cast.some((c) => c.id === e.id))
          .map((e) => ({ id: e.id, standing: "npc" as const, lastSpokeTurn: 0 }))
      : [],
    worldNotes: imports.worldNotes ? prev.worldNotes : [],
    // The map carries, the position never does: a new adventure starts with
    // `area` blank whatever was ticked, so the first turn names where it opens
    // and an imported place is simply somewhere already described when the
    // story reaches it.
    places: imports.places ? prev.places : [],
  };
}
