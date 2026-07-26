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
  description: string;
  personality: string;
  drive: string;
  /** What they are good at, free text. */
  strengths: string;
  /** What they are bad at — the counterweight to strengths, free text. */
  flaws: string;
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
    "species" | "description" | "personality" | "drive" | "strengths" | "flaws"
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

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  turn: number;
  /** The outcome band handed to the narrator for this turn, if any was rolled. */
  outcome?: TurnOutcome;
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
export type LegacyCharacter = Character & {
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

export interface Settings {
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
