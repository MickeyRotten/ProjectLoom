/**
 * Project Loom — on-device data model (DESIGN.md → Data Model).
 * One active GameState is autosaved continuously; named save slots (Phase 4)
 * are full snapshots of the same shape.
 */

export type Op = "add" | "update" | "remove";

/**
 * Pre-split Strengths: a short label plus a sentence. The label is gone —
 * `Character.strengths` is ONE free-text field now, and so is `flaws`. Only
 * migration (`strengthsText`) still reads this shape, out of saves, reversal
 * snapshots and story overrides written before the change.
 */
export interface LegacyStrengths {
  name: string;
  description: string;
}

export interface Equipment {
  label: string;
  description: string;
}

export type CharacterRole = "pc" | "member";

/**
 * An authored character in the GLOBAL cast library — adventure-independent and
 * outliving every New Adventure. Party membership and everything else that is
 * true only "this run" lives in `RosterEntry`, not here.
 */
export interface Character {
  id: string;
  role: CharacterRole;
  name: string;
  species: string;
  /**
   * Sex / gender, free text like `species` — the vocabulary is the setting's,
   * not ours. Read by the narrator (pronouns) and by the portrait prompt.
   */
  sex: string;
  description: string;
  personality: string;
  drive: string;
  /** What they are good at, free text. */
  strengths: string;
  /** What they are bad at — the counterweight to strengths, free text. */
  flaws: string;
  /**
   * The PLAYER's own notes on this character — the one sheet field the model
   * never writes. No `add` carries it, no `update` can touch it, Auto-Update
   * skips it and there is no ✦ generate button beside it: it exists precisely
   * so the player has somewhere to say what a character is that nothing can
   * overwrite. The narrator READS it like any other sheet field.
   */
  notes: string;
  /**
   * Worn / carried gear. Authored once by the narrator on the `add` that
   * creates the character (read off their appearance) and the player's from
   * then on — no later delta touches it.
   */
  equipment: Equipment[];
  /** When true, `customPortraitPrompt` replaces the auto-built portrait prompt. */
  useCustomPortraitPrompt?: boolean;
  /** Player-authored portrait prompt, used only when the flag above is on. */
  customPortraitPrompt?: string;
  /**
   * The player removed this character's portrait and wants them to STAY
   * portrait-less: the deterministic "no cached portrait → generate one" trigger
   * skips them, so the removal survives the next turn instead of being undone by
   * it. Cleared by an explicit ⟳ regenerate or an upload.
   */
  noPortrait?: boolean;
}

/**
 * Where a character stands in the CURRENT adventure — one ladder, not two
 * orthogonal flags. `active`/`benched` are the party (benched = still one of
 * yours, just not in this scene); `npc` is an important ally the world knows
 * but who does not travel with you; `departed`/`fallen` left the story.
 * `none` is a character this adventure simply hasn't involved.
 */
export type Standing =
  | "none"
  | "npc"
  | "active"
  | "benched"
  | "departed"
  | "fallen";

/** The party standings — what `PARTY` and the strip are made of. */
export const PARTY_STANDINGS = ["active", "benched"] as const;

/** The standings a character can no longer travel back from on their own. */
export const PARTED_STANDINGS = ["departed", "fallen"] as const;

/**
 * Pre-`Standing` vocabulary: party membership was a boolean and this enum
 * recorded why someone wasn't in it. Read-only now — `normalizeEntry` folds
 * both into `Standing`.
 */
export type CharacterStatus = "active" | "departed" | "fallen";

/**
 * Fields the story may diverge from the base character for this adventure only.
 * Auto-Update writes here — the narrator no longer does, since a sheet freezes
 * once the character exists. The player's own sheet edits write the base
 * character (and clear the matching overrides).
 */
export type CharacterOverride = Partial<
  Pick<
    Character,
    "species" | "sex" | "description" | "personality" | "drive" | "strengths" | "flaws"
  >
>;

/**
 * Per-adventure state for one character, keyed by `Character.id`. SPARSE — a
 * character with no entry is simply not in the party and has never spoken, so a
 * fresh adventure ships `roster: []` and the party is empty by construction.
 */
export interface RosterEntry {
  id: string;
  standing: Standing;
  lastSpokeTurn: number;
  overrides?: CharacterOverride;
  /**
   * What this adventure has done to them — "left arm in a sling", "out of
   * arrows", "hunted by the Watch". Free text, per-adventure, and the only
   * character state a COST outcome can write (see `stakes.ts`). Absent or
   * blank means unmarked; the sheet is never touched.
   */
  condition?: string;
}

/**
 * A roster entry as it may arrive from storage: saves written before the
 * `Standing` ladder carry `inParty` + `status` instead. `normalizeEntry` is the
 * only thing that reads this shape.
 */
export type LegacyRosterEntry = Partial<RosterEntry> & {
  id: string;
  inParty?: boolean;
  status?: CharacterStatus;
};

/** A character resolved for use: base ⊕ this adventure's override + state. */
export interface PartyMember extends Character {
  lastSpokeTurn: number;
  standing: Standing;
  /** This adventure's mark on them; "" when unmarked. */
  condition: string;
}

export interface Item {
  label: string;
  description: string;
  quantity: number;
}

export type QuestStatus = "active" | "done";

export interface Quest {
  id: string;
  label: string;
  description: string;
  reward: string;
  status: QuestStatus;
}

export interface Note {
  id: string;
  title: string;
  keywords: string[];
  content: string;
  /**
   * Always inject this note, regardless of keyword matches — for setting-wide
   * lore the narrator should never lose. Optional: saves written before the
   * flag existed load as keyword-matched notes.
   */
  permanent?: boolean;
}

export type MessageRole = "player" | "narrator";

/**
 * The outcome band a risky action resolved to, decided ON-DEVICE before the
 * call (see `stakes.ts`). Recorded on the narrator message so the transcript
 * keeps showing the roll that produced the beat.
 */
export type TurnOutcome = "strong" | "mixed" | "cost";

/**
 * The arithmetic behind a `TurnOutcome`, recorded so the transcript can show the
 * roll and not just the verdict. The band alone read as the app's opinion of the
 * beat; the numbers show it was a die, and that Strengths/Flaws moved it.
 *
 * Kept as flags rather than a prose note so the wording stays in one place
 * (`stakes.ts → modifierNote`) and old saves can't pin an old phrasing.
 */
export interface TurnRoll {
  /** The dice total, before the modifier. */
  roll: number;
  /**
   * Each die as it landed — `[4, 3]` for 2d6. Absent on records written while
   * the roll was always a single die, and on single-die rolls, where the total
   * already says everything.
   */
  dice?: number[];
  /** How many dice were rolled. Absent on pre-`DiceRules` records, which read as 1. */
  count?: number;
  /** Sides per die. Absent on pre-`DiceRules` records, which read as 6. */
  sides?: number;
  /** What Strengths/Flaws added or took off — see `DiceRules`. */
  modifier: number;
  /** `roll + modifier` — what the band was read off. */
  total: number;
  /** The action leant on the actor's Strengths. */
  strengths?: boolean;
  /** The action leant on the actor's Flaws. */
  flaws?: boolean;
}

/**
 * One throw of the dice, staged for the full-screen toss (`DiceOverlay`).
 *
 * A cast is transient UI, never persisted: the authoritative record of what was
 * rolled is `Message.roll`, written when the turn lands. This is the same
 * numbers handed to the animation the moment they are known — before the model
 * has written a word — so the tumble plays over the wait for the first token
 * instead of adding a delay of its own.
 *
 * `id` exists so a timer belonging to a finished cast cannot clear the next one.
 */
export interface DiceCast {
  id: string;
  roll: TurnRoll;
  outcome: TurnOutcome;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  turn: number;
  /** The outcome band handed to the narrator for this turn, if any was rolled. */
  outcome?: TurnOutcome;
  /**
   * The roll that produced `outcome`. Absent on turns recorded before it was
   * kept (and on turns that rolled nothing) — those still show their band.
   */
  roll?: TurnRoll;
  /** The parsed delta block applied by this turn — recorded for reversal (Phase 5). */
  appliedDeltas?: LoomBlock;
  /** Pre-turn slices this turn overwrote — undo/regenerate restores them (Phase 5). */
  reversal?: Reversal;
  /** Scene snapshot at this message, for header display + reversal restore. */
  day?: number;
  location?: string;
  weather?: string;
}

/**
 * Phase 5 reversal snapshot. Op-based deltas are lossy to invert (a party
 * `remove` only changes standing, an inventory `add` merges quantity), so a turn instead
 * records exactly the mutable slices it is about to overwrite. Undo restores
 * them wholesale — exact and order-preserving. Scalars are always captured; a
 * slice is present only when the turn actually touched it, keeping most turns
 * tiny.
 */
export interface Reversal {
  day: number;
  location: string;
  weather: string;
  roster?: RosterEntry[];
  /**
   * Pre-split saves stored the whole character array here. Kept readable so
   * undo still works on turns recorded before the roster/library split.
   */
  characters?: LegacyCharacter[];
  inventory?: Item[];
  quests?: Quest[];
  worldNotes?: Note[];
}

/**
 * A character record as written before the Characters/Party split, when party
 * state lived on the character itself. Only migration + legacy reversal read it.
 */
export type LegacyCharacter = Omit<Character, "sex" | "notes"> & {
  /** Absent from every record written before the field existed. */
  sex?: string;
  /** Likewise — player notes arrived after every one of these records. */
  notes?: string;
  lastSpokeTurn?: number;
  inParty?: boolean;
  portraitKey?: string;
};

export interface Scenario {
  title: string;
  premise: string;
  openingNarration: string;
  startDay: number;
  /** Location name the game opens in; seeds GameState.location on New Adventure. */
  startLocation: string;
}

export interface GameState {
  scenario: Scenario;
  /** Per-adventure character state. The cast itself is stored globally. */
  roster: RosterEntry[];
  worldNotes: Note[];
  inventory: Item[];
  quests: Quest[];
  messages: Message[];
  turnNumber: number;
  day: number;
  location: string;
  weather: string;
  /**
   * Turn number the last location banner was GENERATED on (never a cache hit).
   * Feeds `Settings.bannerCooldown` — see `images.ts → bannerOnCooldown`.
   * Undefined on a fresh or pre-cooldown adventure, which reads as "never".
   */
  lastBannerTurn?: number;
}

/**
 * 1-bit post-process mode: Bayer ordered dither (textured), plain 50%
 * threshold (flat), or off (raw model output, no quantize pass).
 */
export type DitherMode = "bayer4" | "threshold" | "off";

/**
 * A user-uploaded portrait style reference image. Stored inline in Settings
 * (localStorage) as base64 — uploads are downscaled client-side first so up to
 * three of them stay well under the storage quota.
 */
export interface RefImage {
  mime: string;
  b64: string;
}

/**
 * Reading size for the narration log. Only the prose scales — buttons, labels
 * and every other control keep their size, so a large setting buys text and not
 * a blown-up interface.
 */
export type TextScale = "s" | "m" | "l" | "xl";

/**
 * The typeface the whole app renders in (Settings → Appearance). `system` is
 * the platform monospace stack Loom shipped with; the other two are bitmap-era
 * display faces bundled with the app (`src/fonts/`, SIL OFL) so the APK never
 * reaches the network for a glyph.
 */
export type FontChoice = "system" | "vt323" | "jersey15";

/** The fonts, in the order the picker shows them. */
export const FONT_CHOICES = ["system", "vt323", "jersey15"] as const;

/**
 * How much room the location banner takes. `compact` keeps the art reachable (a
 * tap still opens it full-screen) while handing the reading area back ~90px on
 * a phone — the banner, the party strip and the composer together were eating
 * over half the viewport of a text-first app.
 */
export type BannerSize = "full" | "compact";

/**
 * How hard the text model is asked to think before it writes (OpenRouter's
 * unified `reasoning` parameter). `auto` sends no reasoning field at all, so the
 * model does whatever it does by default — the shipped value, and the only one
 * that behaves identically on a model with no reasoning support. `off` asks for
 * reasoning to be DISABLED, which matters on models that think by default and
 * bill for it; the rest map to an effort level.
 */
export type ReasoningLevel = "auto" | "off" | "minimal" | "low" | "medium" | "high";

/** The levels, in the order the picker shows them. */
export const REASONING_LEVELS = [
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
] as const;

/** The levels that map to an OpenRouter `reasoning.effort` value. */
export type ReasoningEffort = Exclude<ReasoningLevel, "auto" | "off">;

/**
 * The dice a risky action is resolved with (Menu → RPG System). These six
 * numbers were hardcoded in `stakes.ts` — one d6, ±1 for Strengths/Flaws, bands
 * at 5+ / 3–4 / 2− — which made "the system" a thing only the app knew. They are
 * the player's now: 2d6 for a swingy table, 1d20 for a fine-grained one, a fat
 * Strengths bonus for a power fantasy.
 *
 * Sanitized by `stakes.ts → normalizeDice` on every read, so a corrupt or
 * hand-edited value degrades to something rollable instead of breaking turns.
 */
export interface DiceRules {
  /** How many dice are rolled each time. */
  diceCount: number;
  /** Sides per die. */
  diceSides: number;
  /** Added to the total when the attempt leans on the actor's Strengths. */
  strengthsBonus: number;
  /** Taken off the total when it leans on their Flaws. */
  flawsPenalty: number;
  /** Totals at or above this are STRONG. */
  strongThreshold: number;
  /** Totals at or above this — but under `strongThreshold` — are MIXED; below, COST. */
  mixedThreshold: number;
}

export interface Settings extends DiceRules {
  openRouterKey: string;
  /**
   * Whether the player has been through first-run setup. Gates `SetupScreen`.
   * Deliberately its own flag rather than "is there a key": gating on the key
   * would throw the player out of setup on the first character they typed.
   */
  setupDone: boolean;
  /**
   * Optional separate OpenRouter key for image generation — lets the player
   * track image spend against its own key. Blank falls back to openRouterKey.
   */
  imageKey: string;
  textModelId: string;
  imageModelId: string;
  temperature: number;
  /**
   * Thinking effort for the text model — narration and side calls alike. See
   * `ReasoningLevel`; `settings.ts → reasoningParam` turns it into the request
   * field (or omits it).
   */
  reasoningLevel: ReasoningLevel;
  /** When false, the narrator is not asked for action options and none render. */
  showActionOptions: boolean;
  /** Flip ink/paper — the "black paper" reading of the 1-bit theme. */
  invert: boolean;
  /** Reading size for narration. Chrome (buttons, labels) never scales. */
  textScale: TextScale;
  /** Typeface for the whole app — see `FontChoice`. */
  font: FontChoice;
  /**
   * Whether location images exist at all. Off by default: a banner is an image
   * generation on every new location, which is the app's most expensive habit
   * and the one least tied to play. Off means no generation, no cached-image
   * display, and none of the banner UI — the banner itself, its Menu size
   * toggle, and the Advanced → Images banner settings all disappear rather than
   * sitting there doing nothing.
   */
  locationImages: boolean;
  /** Whether the location banner shows full height or as a thin strip. */
  bannerSize: BannerSize;
  // Advanced (player-editable, Phase 4):
  customInstructions: string;
  bannerInstructions: string;
  /**
   * Turns to skip automatic location-banner generation for after one is
   * generated — a spend brake for location-heavy play. 0 = off (every new
   * location draws immediately). Cached locations always show, and ⟳ always
   * regenerates.
   */
  bannerCooldown: number;
  /** Portrait Action/Location-context/Composition/Style clauses (Nano Banana formula). Subject is auto-built from name/species/description, never a settings field. */
  portraitAction: string;
  portraitContext: string;
  portraitComposition: string;
  portraitStyle: string;
  /** Style reference images (0–3, ordered) sent with every portrait generation. */
  portraitRefImages: RefImage[];
  /** Line appended to portrait prompts only when reference images are present. */
  portraitRefInstruction: string;
  /** How generated images are quantized to true 1-bit on-device. */
  ditherMode: DitherMode;
  /**
   * Narrator guidance for party "description" fields — the appearance text
   * that later becomes the member's portrait Subject verbatim.
   */
  appearanceInstructions: string;
  /**
   * What the narrator must write when it introduces a character (`add`) — the
   * one moment it authors a sheet, since everything below freezes afterwards.
   */
  characterCreationInstructions: string;
  /**
   * The freeze rule: a created character's sheet is no longer the narrator's to
   * rewrite. `deltas.ts` enforces it regardless; this is what stops the model
   * spending tokens trying.
   */
  characterUpdateInstructions: string;
  /** How the narrator seats a character — active / benched / npc. */
  standingInstructions: string;
  /** How the narrator writes someone out — departed / fallen. */
  departureInstructions: string;
  optionInstructions: string;
  spotlightRule: string;
  /**
   * Whether risky actions are resolved on-device into an outcome band the
   * narrator must honour (`stakes.ts`). Off restores the pure-sandbox
   * behaviour: the narrator decides how everything goes.
   */
  stakesEnabled: boolean;
  /** What the narrator does with the band it is handed — the editable half. */
  stakesRule: string;
  /**
   * The words that make an action a gamble, comma- or newline-separated
   * (`stakes.ts → parseKeywords`). Blank means nothing ever reads as risky, so
   * only `alwaysRoll` can produce a roll.
   */
  riskKeywords: string;
  /**
   * Roll on EVERY turn instead of only on keyword-matched attempts — the
   * "everything is a check" table. `riskKeywords` is unused while this is on.
   */
  alwaysRoll: boolean;
  /**
   * Toss the dice across the screen when a turn rolls (`DiceOverlay`) instead of
   * only printing the result on the beat's chip. Purely presentational — the
   * numbers are decided before the animation exists, and turning it off changes
   * nothing about how a turn resolves.
   */
  diceAnimation: boolean;
  /**
   * Approximate token budget for the rolling history window. The only thing
   * standing between a long game and amnesia, so it is the player's to raise on
   * a large-context model.
   */
  historyBudget: number;
  /** Cap on a beat's length, in tokens. 0 sends no cap at all. */
  maxTokens: number;
}

/* ------------------------------------------------------------------ *
 * The <<<LOOM>>> machine-read block (loom-turn-protocol).
 * All fields optional; op-based arrays for party/inventory/quests.
 * ------------------------------------------------------------------ */

/**
 * A character op. The sheet fields are read on CREATION only — an op naming a
 * character who already exists moves their `standing` and nothing else (see
 * `deltas.ts → applyParty`), so the story can never rewrite an authored sheet.
 */
export interface PartyDelta {
  op: Op;
  name: string;
  species?: string;
  sex?: string;
  description?: string;
  personality?: string;
  drive?: string;
  /**
   * Free text. Blocks recorded before Strengths lost its label carry the old
   * `{ name, description }` object; `strengthsText` folds either shape.
   */
  strengths?: string | LegacyStrengths;
  flaws?: string;
  /**
   * The character's starting gear, written from their appearance on the
   * creating `add`. Ignored on every other op — equipment is the player's
   * after that.
   */
  equipment?: Equipment[];
  /**
   * Where this character stands after the op. On `add`/`update` the narrator
   * may say `active` (travelling), `benched` (with the party, out of the
   * scene) or `npc` (known to the world, not a companion); on `remove` it is
   * why they left. Defaults: `active` on add, `departed` on remove.
   */
  standing?: Standing;
  /**
   * Pre-`standing` spelling of the same thing on `remove`. Still read, because
   * reversal replays `appliedDeltas` blocks recorded before the rename.
   */
  status?: Exclude<CharacterStatus, "active">;
}

/**
 * A mark the story leaves on someone. Matched by name across the WHOLE cast
 * library — the PC included, unlike `PartyDelta`, because the player is who a
 * COST outcome lands on most often. A blank `condition` clears the mark.
 *
 * Deliberately its own op-less channel rather than a `PartyDelta` field: party
 * ops carry the frozen-sheet rules, and a condition is the one piece of
 * character state the story is *supposed* to keep rewriting.
 */
export interface ConditionDelta {
  name: string;
  condition: string;
}

export interface InventoryDelta {
  op: Op;
  label: string;
  description?: string;
  quantity?: number;
}

export interface QuestDelta {
  op: Op;
  label: string;
  description?: string;
  reward?: string;
  status?: QuestStatus;
}

/**
 * A World Note the narrator wrote for itself. The rolling history window is the
 * only memory a long game has, and everything that falls out of it is gone; a
 * note is how a fact survives, keyword-gated back in by `worldNotes.ts` for the
 * rest of the adventure. Player-visible and editable on the World Notes screen,
 * which is the point — a hidden summary cannot be corrected.
 */
export interface NoteDelta {
  op: Op;
  title: string;
  content?: string;
  keywords?: string[];
}

export interface LoomBlock {
  location?: string;
  weather?: string;
  day?: number;
  options?: string[];
  party?: PartyDelta[];
  /** Marks the story left on people this turn — see `ConditionDelta`. */
  conditions?: ConditionDelta[];
  inventory?: InventoryDelta[];
  quests?: QuestDelta[];
  /** Lore the narrator committed to memory this turn — see `NoteDelta`. */
  notes?: NoteDelta[];
  spoke?: string[];
}
