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

/**
 * The four build axes an RPG System character rolls against (`attributes.ts`),
 * each an integer −1..3. Frozen on a character the same way Equipment and
 * Appearance are — the narrator never writes them; the player picks them at
 * creation and can revise them any time on the sheet.
 */
export type Attribute = "might" | "agility" | "mind" | "presence";

export const ATTRIBUTES: Attribute[] = ["might", "agility", "mind", "presence"];

export type Attributes = Record<Attribute, number>;

/**
 * A named skill in the player-editable Specialisation catalog
 * (`Settings.specialisations`), tied to one Attribute. A character's own held
 * set is `Character.specialisations: string[]`, referencing catalog ids.
 */
export interface Specialisation {
  id: string;
  label: string;
  attribute: Attribute;
}

/**
 * A GM move the narrator reaches for on a Fail or a hesitant turn, instead of
 * freelancing a consequence (`Settings.gmMoves`) — see `gmMoves.ts`.
 */
export interface GMMove {
  id: string;
  label: string;
  description: string;
}

/**
 * The knobs behind the percentile roll (Menu → RPG System → Results),
 * sanitized at read time by `attributes.ts → normalizeAttributeRules` the same
 * way `DiceRules` used to be by `normalizeDice`.
 */
export interface AttributeRules {
  /** Flat starting chance before any Attribute, gear, or Specialisation applies. */
  baseChance: number;
  /** Percent added per point of the acting Attribute (may be negative on a −1). */
  attributePoint: number;
  /** Flat percent added when the classifier matched a held Specialisation. */
  specialisationBonus: number;
  /** The Target Number is never allowed below this. */
  minChance: number;
  /** Nor above this. */
  maxChance: number;
  /** The MIXED band's width, as a percent of the Target Number. */
  mixedMarginPct: number;
  /** The MIXED band's width is never allowed below this many points. */
  minMargin: number;
}

/**
 * The classifier's verdict on one action (`intent.ts`) — whether it is risky,
 * and if so which Attribute and (optionally) which held Specialisation it
 * plays to. Cached on the turn's `Message` so a regenerate replays the same
 * verdict instead of reclassifying (an LLM call, unlike the roll itself, is
 * not a pure function of the seed).
 */
export interface IntentVerdict {
  risky: boolean;
  attribute: Attribute | null;
  /** A Specialisation catalog id from the acting character's own held list. */
  specialisation: string | null;
}

export interface Equipment {
  label: string;
  description: string;
  /**
   * How many there are. Absent on every record written before gear could move
   * between the pack and a character, and on every narrator-authored kit, so it
   * reads as one (`equip.ts → equipQuantity`) rather than as zero.
   *
   * It exists because equipping is a MOVE, not a copy: an `Item` carries a
   * count and an `Equipment` row that could not would lose it, turning twelve
   * arrows into one the moment they were handed to the archer.
   */
  quantity?: number;
  /**
   * Purely mechanical, purely player-set fields — never model-authored, the
   * same precedent `equip.ts → canEquip` already sets by refusing Gold ("the
   * purse is the party's"). `grantedSpecialisation` is a picker into the
   * Specialisation catalog, not free text, for the same precision-matching
   * discipline the output protocol already enforces on inventory labels.
   */
  attributeBonus?: { attribute: Attribute; amount: number };
  grantedSpecialisation?: string;
}

export type CharacterRole = "pc" | "member";

/**
 * What mechanical role a block plays, independent of its title or position —
 * the thing that lets the dice roll, the portrait prompt and Auto-Update find
 * "the Strengths block" / "the Appearance block" / etc. even after the player
 * retitles or reorders it. `"custom"` is every player-added block and every
 * Item block (items have no mechanical kind of their own).
 */
export type BlockKind =
  | "appearance"
  | "personality"
  | "drive"
  | "strengths"
  | "flaws"
  | "notes"
  | "custom";

interface BlockCommon {
  /** Stable, never reused — the override key, the ✦-generate target, the React key. */
  id: string;
  kind: BlockKind;
  title: string;
  /** Skipped from the rendered sheet (and so from the prompt) when false; stays in the list. */
  enabled: boolean;
}

/** A title + freeform text block — what Appearance/Personality/Drive/etc. are made of now. */
export interface TextBlock extends BlockCommon {
  type: "text";
  text: string;
}

/**
 * One piece of gear. The special block type Equipment became: `title` is the
 * item's label, `text` its description, `quantity` how many — same shape as a
 * Text block plus a count, so `equip.ts` can move it whole between a
 * character's blocks and the shared pack (`Item`).
 */
export interface ItemBlock extends BlockCommon {
  type: "item";
  kind: "custom";
  text: string;
  quantity: number;
  /** Purely mechanical, player-set only — see `Equipment.attributeBonus`. */
  attributeBonus?: { attribute: Attribute; amount: number };
  grantedSpecialisation?: string;
}

export type Block = TextBlock | ItemBlock;

/**
 * An authored character in THIS adventure's cast (`GameState.characters`) — the
 * sheet, and only the sheet. Party membership and everything else that changes
 * as the story runs lives in `RosterEntry`, not here.
 *
 * The cast used to be global, outliving every New Adventure. It isn't: a save
 * slot is a snapshot of a whole adventure, and a cast sitting outside it meant
 * restoring one gave you the story back with somebody else's people in it — the
 * player character included. It lives in the game document now, which is what
 * makes a snapshot restore the game you actually saved.
 */
export interface Character {
  id: string;
  role: CharacterRole;
  name: string;
  /**
   * Names this character has answered to before, most recent last. Written
   * only by a rename (`names.ts → withRename`) — the narrator's `"newName"`
   * party op, or the player editing the sheet — and read by every matcher that
   * resolves a name back to a character. The history window and the journal
   * keep saying whatever the scene said at the time, so without this a rename
   * silently breaks speaker detection, NPC gating and Auto-Update's story scan
   * until the transcript rolls over.
   */
  aliases?: string[];
  species: string;
  /**
   * Sex / gender, free text like `species` — the vocabulary is the setting's,
   * not ours. Read by the narrator (pronouns) and by the portrait prompt.
   */
  sex: string;
  /**
   * The sheet body — an ordered, player-editable list of blocks (Text or
   * Item), each independently enabled/disabled, fed to the narrator verbatim
   * and in order, wrapped in an open/close tag (`blocks.ts → wrapCharacter`)
   * so it can't bleed into another character's or the surrounding prompt.
   * `species`/`sex`/`name` stay outside the list — see `BlockKind`.
   */
  blocks: Block[];
  /**
   * The RPG System build — four −1..3 scores. Frozen against the narrator the
   * same way Equipment and Appearance are: the player picks them at creation
   * (`attributes.ts → defaultAttributes` on a fresh character) and can revise
   * them any time on the sheet. Absent on a character read from a save written
   * before this existed, which reads as all-zero (`attributes.ts →
   * characterAttributes`).
   */
  attributes?: Attributes;
  /**
   * Specialisation catalog ids this character holds — the player's pick at
   * creation, editable any time. Absent reads as none
   * (`attributes.ts → characterSpecialisations`).
   */
  specialisations?: string[];
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
 * A character sheet as it was before the block-list refactor — six fixed text
 * fields plus an `Equipment[]` list, instead of `Character.blocks`. Only
 * `defaults.ts → migrateCharacter`/`migrateCharacterToBlocks` and legacy
 * reversal (`Reversal.characters`) read this shape now.
 */
export interface LegacyFixedFieldCharacter {
  id: string;
  role: CharacterRole;
  name: string;
  aliases?: string[];
  species: string;
  sex: string;
  description: string;
  personality: string;
  drive: string;
  strengths: string;
  flaws: string;
  notes: string;
  equipment: Equipment[];
  useCustomPortraitPrompt?: boolean;
  customPortraitPrompt?: string;
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
 *
 * `blocks` is keyed by `Block.id`, not by kind or title — a block survives
 * rename/reorder, so the override keeps applying to the right one regardless.
 * Only a Text block's `text` can be overridden; Item blocks are never
 * auto-rewritten.
 */
export interface CharacterOverride {
  species?: string;
  sex?: string;
  blocks?: Record<string, string>;
}

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
  /** Purely mechanical, player-set only — see `Equipment.attributeBonus`. */
  attributeBonus?: { attribute: Attribute; amount: number };
  grantedSpecialisation?: string;
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

/**
 * An AREA — the place the scene is in, one level above the room named by
 * `GameState.location`.
 *
 * Slim on purpose: what a place needs to give the narrator consistency now
 * lives one level up, in the world seed (`Scenario`'s tone/factions/etc) —
 * this only has to remember one specific area, not carry a whole per-kind tag
 * taxonomy for it. Authored once by a side call the first time the player
 * arrives somewhere new (`generatePlace.ts`), then frozen against the model
 * and editable by the player, exactly like a character sheet. There is no
 * place delta channel: the narrator reads places, it never writes them.
 */
export interface Place {
  id: string;
  name: string;
  /** Other names this area answers to — resolution matches these too. */
  aliases?: string[];
  description: string;
  /** Extra words that pull this place into the prompt when it is not the scene. */
  keywords: string[];
  /**
   * Named but not yet authored — an arrival whose side call has not landed.
   * A stub still resolves and still injects (its name is a fact); it simply
   * has nothing to say yet.
   */
  pending?: boolean;
}

export type MessageRole = "player" | "narrator";

/**
 * The outcome band a risky action resolved to, decided ON-DEVICE before the
 * call (see `stakes.ts`). Recorded on the narrator message so the transcript
 * keeps showing the roll that produced the beat.
 */
export type TurnOutcome = "strong" | "mixed" | "cost";

/**
 * The percentile roll behind a `TurnOutcome`, recorded so the transcript can
 * show the check and not just the verdict — a bare "It cost you" read as the
 * app editorialising about the beat; the numbers show it was a roll against a
 * real chance.
 *
 * `breakdown` is frozen prose (`stakes.ts → formatBreakdown`), the same
 * discipline `modifierNote` used to give the old dice system: built once, at
 * roll time, so a Specialisation later renamed or removed from the catalog
 * can't change what an old beat's chip says it was rolled with.
 */
export interface TurnRoll {
  /** Percentile roll, 1–100. */
  roll: number;
  /** Target Number this roll was checked against, clamped to `AttributeRules`. */
  tn: number;
  /** What built the Target Number — "Might +2, Hammers specialisation, gear +1", or "" for a bare base chance. */
  breakdown: string;
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
  /**
   * The classifier's verdict for this turn (`intent.ts`) — cached so
   * `regenerateLastTurn` can replay it instead of reclassifying. Absent on a
   * turn resolved before this existed, and on one that never classified
   * (stakes off).
   */
  intent?: IntentVerdict;
  /** The parsed delta block applied by this turn — recorded for reversal (Phase 5). */
  appliedDeltas?: LoomBlock;
  /** Pre-turn slices this turn overwrote — undo/regenerate restores them (Phase 5). */
  reversal?: Reversal;
  /** Scene snapshot at this message, for header display + reversal restore. */
  day?: number;
  /** Time of day, minutes since midnight. Absent on pre-clock messages. */
  minutes?: number;
  location?: string;
  weather?: string;
  /** The area this beat was in — absent on messages recorded before this existed. */
  area?: string;
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
  /** Time of day. Absent on turns recorded before the clock existed. */
  minutes?: number;
  /** The area. Absent on turns recorded before places existed. */
  area?: string;
  location: string;
  weather: string;
  roster?: RosterEntry[];
  /**
   * Present only on a turn that opened a journal entry — which is why the entry
   * is created SYNCHRONOUSLY when the turn lands, before its prose is fetched.
   * A snapshot taken before an async append would restore to a state the entry
   * was already in.
   */
  journal?: JournalEntry[];
  /**
   * Pre-split saves stored the whole character array here. Kept readable so
   * undo still works on turns recorded before the roster/library split.
   */
  characters?: LegacyCharacter[];
  inventory?: Item[];
  quests?: Quest[];
  worldNotes?: Note[];
  /**
   * Present only on a turn that discovered an area — the stub is written
   * SYNCHRONOUSLY when the turn lands, for the same reason the journal entry
   * is: its prose arrives later, and a snapshot taken after an async fill would
   * restore to a state the place was already in.
   */
  places?: Place[];
}

/**
 * A character record as written before the Characters/Party split, when party
 * state lived on the character itself. Only migration + legacy reversal read it.
 */
export type LegacyCharacter = Omit<LegacyFixedFieldCharacter, "sex" | "notes"> & {
  /** Absent from every record written before the field existed. */
  sex?: string;
  /** Likewise — player notes arrived after every one of these records. */
  notes?: string;
  lastSpokeTurn?: number;
  inParty?: boolean;
  portraitKey?: string;
};

/** One named power already in tension with others — a `Scenario.factions` row. */
export interface Faction {
  name: string;
  /** 1-2 lines: what they want, who they are already in tension with. */
  description: string;
}

/**
 * A proper noun the world seed treats as already existing — a `Scenario.fixedPoints`
 * row. Small in number by design: its job is to anchor early generation, not to
 * pre-populate the map.
 */
export interface FixedPoint {
  name: string;
  /** One line: what it is, or who they are. */
  description: string;
}

/**
 * The world seed: the one small, always-injected document that keeps
 * lazily-generated content (areas, NPCs, events) consistent with itself,
 * instead of each side call improvising the setting fresh. See DESIGN.md →
 * World Seed. Every field beyond `premise` is a short bullet list, not a
 * paragraph — the moment a field grows past what fits on a screen it is
 * becoming a location spec, not a seed, and belongs on a `Place` or a World
 * Note instead.
 *
 * The narrator never writes any of this: it is authored once, by the player
 * (✦-assisted), and grown deliberately by promoting a World Note into
 * `threads`/`fixedPoints` — never implicitly, from inside narration.
 */
export interface Scenario {
  title: string;
  /** The world this adventure happens in, who lives in it, its tone. */
  premise: string;
  /** Mood and hard boundaries — what this world is, and is not. */
  tone: string[];
  /** Scale, tech/magic level, rules that shouldn't be broken. */
  physicalLogic: string[];
  /** 2-4 named powers already in tension. */
  factions: Faction[];
  /** 1-3 open questions that can resurface later — phrased as questions, not answers. */
  threads: string[];
  /** Roughly how dangerous early vs. late areas should feel. */
  dangerCurve: string[];
  /** A handful of proper nouns (places/people) that already exist. */
  fixedPoints: FixedPoint[];
  openingNarration: string;
  startDay: number;
  /** Location name the game opens in; seeds GameState.location on New Adventure. */
  startLocation: string;
}

/**
 * One line of a journal entry, and who wrote it.
 *
 * `system` lines are derived by the client from `Message.appliedDeltas` — the
 * same records `toasts.ts` reads for its chips — so they are exact, free, and
 * cannot be invented. `model` lines come from the side call and cover what left
 * no state change behind: crossed the marsh, refused the ferryman, the bridge
 * was out. The tag is what lets an old entry decay to its facts instead of
 * disappearing: `model` lines drop out of the prompt first.
 */
export interface JournalLine {
  text: string;
  source: "system" | "model";
}

/**
 * A day's worth of what happened, as a short list.
 *
 * The rolling history window is a fixed token budget, so a turn that falls out
 * of it has never happened as far as the model is concerned. The journal is
 * what catches that material: written at a boundary the CLIENT decides (see
 * `journal.ts`), from the full transcript in `GameState.messages` rather than
 * from the trimmed window, and injected as its own always-on block.
 *
 * Player-visible and editable, which is the whole argument for it over a hidden
 * rolling summary — a summary that quietly gets a fact wrong is unfixable.
 */
export interface JournalEntry {
  id: string;
  /** The day the entry STARTED. An entry may span a midnight. */
  day: number;
  fromTurn: number;
  throughTurn: number;
  lines: JournalLine[];
}

export interface GameState {
  scenario: Scenario;
  /**
   * This adventure's cast — every authored sheet, the PC first among them.
   * Always holds exactly one `role: "pc"` character.
   */
  characters: Character[];
  /**
   * Per-adventure character STATE, keyed by `Character.id` — standing,
   * last-spoke, conditions, story overrides. Still separate from the sheets
   * above even though both now live in this document: a sheet is authored once
   * and frozen, and this is the half the story keeps rewriting.
   */
  roster: RosterEntry[];
  worldNotes: Note[];
  /**
   * The areas this adventure knows about — see `Place`. Per-adventure, because
   * a place is a fact about the story being played, not about the app.
   */
  places: Place[];
  inventory: Item[];
  quests: Quest[];
  messages: Message[];
  /** What happened, in order — see `JournalEntry`. Per-adventure. */
  journal: JournalEntry[];
  turnNumber: number;
  day: number;
  /**
   * Time of day, minutes since midnight. Internal: never rendered as a clock
   * face and never sent to the model, which only ever sees a phase word
   * (`clock.ts → phaseOf`).
   */
  minutes: number;
  /**
   * The AREA the scene is in — the name of a `Place`. One level above
   * `location`, which is the room within it. Blank on a game that has never
   * moved, and on every save written before places existed.
   */
  area: string;
  location: string;
  weather: string;
}

/**
 * What a New Adventure carries over from the one being replaced.
 *
 * Everything here used to be implicit and un-negotiable: the scenario and the
 * whole cast always survived, the world notes never did. Now that the cast is
 * part of the adventure, "start again" has to ask — the same four things are
 * either the setting you have built up over weeks or exactly the baggage you
 * are trying to leave behind, and the app cannot know which.
 *
 * `pc` and `characters` are separate because they usually differ: a new run in
 * the same world with the same hero is the common case, and so is a new hero in
 * a world full of people you wrote.
 */
export interface AdventureImports {
  /** Title, premise, opening narration, start day + location. */
  scenario: boolean;
  /** The player character's sheet, as authored. */
  pc: boolean;
  /** Every other character sheet in the cast. */
  characters: boolean;
  worldNotes: boolean;
  /** The areas already authored — the map of the world, minus where you stood. */
  places: boolean;
}

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
 * One image request, as both backends receive it. Lives here rather than in
 * `images.ts` so `comfyui.ts` can take it without importing the module that
 * dispatches into it.
 */
export interface GenerateImageOptions {
  settings: Settings;
  prompt: string;
  /**
   * Input images as data URLs — the portrait style references. Sent as
   * `input_references` on OpenRouter; the ComfyUI path has no generic place
   * to put them in a player-authored workflow.
   */
  images?: string[];
  /** e.g. "2:3" — `aspect_ratio` on OpenRouter, the latent shape on ComfyUI. */
  aspectRatio?: string;
  signal?: AbortSignal;
}

/**
 * Where generated images come from. `openrouter` is the shipped cloud path;
 * `comfyui` points the same portrait triggers at a ComfyUI instance the player
 * runs themselves. See `lib/comfyui.ts`.
 */
export type ImageBackend = "openrouter" | "comfyui";

/**
 * ComfyUI connection + workflow settings, mixed into `Settings` the way
 * `DiceRules` is — one named group, so `DEFAULT_COMFY` in `lib/comfyui.ts` can
 * be the single definition of "an unconfigured ComfyUI".
 *
 * `comfyWorkflow` is raw ComfyUI API-format JSON with `%placeholder%` tokens.
 * It is the player's to edit, and everything below it exists only to fill those
 * tokens — a workflow that hardcodes its sampler simply ignores the field.
 */
export interface ComfySettings {
  imageBackend: ImageBackend;
  /** Base URL of the ComfyUI server, e.g. `http://127.0.0.1:8188`. */
  comfyUrl: string;
  /** The workflow graph, as text. See `comfyui.ts → DEFAULT_COMFY_WORKFLOW`. */
  comfyWorkflow: string;
  comfyModel: string;
  comfyVae: string;
  comfySampler: string;
  comfyScheduler: string;
  comfySteps: number;
  /** CFG scale — `%scale%`, matching SillyTavern's token name. */
  comfyScale: number;
  /**
   * Base pixel size. A portrait is reshaped to 2:3 at the same pixel area
   * (`comfyui.ts → comfyDimensions`).
   */
  comfyWidth: number;
  comfyHeight: number;
  comfyDenoise: number;
  /** Positive as the player knows it; sent negative, as CLIPSetLastLayer wants. */
  comfyClipSkip: number;
}

/**
 * How an image prompt's parts are joined into one string — the structural half
 * of an `ImagePromptTemplate`, which no amount of rewording could cover.
 *
 * `prose` — the shipped Nano Banana formula: labelled paragraphs ("Appearance:
 * …"), a blank line between them, full sentences. What a chat image model reads.
 * `tags` — Danbooru style: each part stripped of trailing punctuation and
 * comma-joined, with the labels dropped, and the character's NAME left out
 * entirely (it means nothing to a diffusion model's text encoder and costs a
 * scarce token budget). What an SD-family checkpoint reads.
 */
export const PROMPT_FORMATS = ["prose", "tags"] as const;

export type PromptFormat = (typeof PROMPT_FORMATS)[number];

/**
 * One named bundle of image-prompt wording — see `lib/imageTemplates.ts`.
 *
 * Everything here decides how a prompt is WORDED, so it can all be swapped in
 * one pick when the player changes image model. Machine config (backend, URL,
 * checkpoint, sampler, size) and behaviour (`portraitRefImages`) deliberately
 * stay outside, so a template survives changing checkpoints and vice versa.
 *
 * `appearanceInstructions` is in here even though it steers the TEXT model:
 * `Character.description` becomes the portrait's Subject verbatim, so a portrait
 * prompt cannot be tags while the sentence that writes its Subject asks for
 * prose.
 */
/**
 * One clause in a portrait prompt's ordered block list — the image-prompt
 * sibling of a character sheet's `Block` (`blocks.ts`). No `kind` tag: a
 * clause plays no mechanical role the way a sheet block's Strengths/Flaws
 * does, so there is nothing to identify it by beyond its own title.
 */
export interface ImagePromptTextBlock {
  id: string;
  type: "text";
  title: string;
  text: string;
}

/**
 * The one block every template carries exactly one of: the character's own
 * Subject (name/species/sex/appearance), injected verbatim at this position
 * in the sequence. Reorderable like any other block — where the Subject falls
 * relative to the Action/Context/Composition/Style clauses is a style choice
 * — but it carries no text of its own to edit, and the one block the block
 * editor refuses to remove: a portrait with no Subject can't be built.
 */
export interface ImagePromptAppearanceBlock {
  id: string;
  type: "appearance";
}

export type ImagePromptBlock = ImagePromptTextBlock | ImagePromptAppearanceBlock;

export interface ImagePromptTemplate {
  id: string;
  name: string;
  format: PromptFormat;
  /**
   * The portrait prompt's clauses, in the order they're assembled — editable,
   * reorderable and removable, except the one `"appearance"` block (see
   * `ImagePromptAppearanceBlock`), which only reorders.
   */
  blocks: ImagePromptBlock[];
  /** Appended to portrait prompts only when reference images are present. */
  portraitRefInstruction: string;
  /**
   * What to keep OUT of the picture. Reaches the ComfyUI path only — a chat
   * image model is told in prose, a diffusion model needs its own list — but it
   * is dialect, not machine config, so it rides here rather than beside the
   * sampler.
   */
  negativePrompt: string;
  /**
   * Narrator guidance for party "description" fields — the appearance text that
   * later becomes the member's portrait Subject verbatim.
   */
  appearanceInstructions: string;
}

/**
 * The typeface the whole app renders in (Settings → Appearance). `system` is
 * the platform monospace stack Loom shipped with; the other two are bitmap-era
 * display faces bundled with the app (`src/fonts/`, SIL OFL) so the APK never
 * reaches the network for a glyph.
 *
 * These are the BUNDLED faces. `Settings.font` also accepts the `id` of any
 * `WebFont` the player has added, which is why it is typed as a plain string —
 * see `settings.ts → fontTheme`.
 */
export type FontChoice = "system" | "vt323" | "jersey15";

/** The bundled fonts, in the order the picker shows them. */
export const FONT_CHOICES = ["system", "vt323", "jersey15"] as const;

/**
 * A Google Web Font the player added by name (Settings → Appearance → Font).
 *
 * Only the identity lives here; the actual woff2 files live in IndexedDB
 * (`db.ts → FONTS_STORE`), downloaded once when the font is added. They are
 * downloaded rather than linked because the packaged APK plays offline — a
 * `<link>` to fonts.googleapis.com would give an added font the opposite
 * property from the two bundled ones: present on wifi, gone on a train.
 */
export interface WebFont {
  /** The family as Google spells it, e.g. "Silkscreen" — the CSS family name. */
  family: string;
  /** Slug of the family: the `data-font` value and the IndexedDB key prefix. */
  id: string;
  /**
   * The `unicode-range` of each stored file, index-aligned with the IndexedDB
   * keys (`font:<id>:0`, `:1`, …). It has to be persisted, not just used at
   * download time: two subset files re-mounted WITHOUT their ranges both claim
   * every character, the later one wins, and a font whose latin-ext file has no
   * basic Latin in it renders the whole app blank.
   */
  ranges: string[];
}

/**
 * One downloaded `@font-face` for an added font — a single subset's file plus
 * the range it covers, parsed off the css2 stylesheet (`webFonts.ts`).
 */
export interface WebFontFace {
  /** Subset label from the stylesheet's per-block comment ("latin"), if any. */
  subset: string;
  /** The `unicode-range` descriptor, verbatim. */
  unicodeRange: string;
  /** Absolute woff2 URL on fonts.gstatic.com. */
  url: string;
}

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
 * Which of the narrator's machinery is switched on (Menu → Features).
 *
 * Every one of these is a subsystem the narrator drives: a prompt block telling
 * it what is true, a `<<<LOOM>>>` channel letting it write back, and a rule in
 * the output protocol joining the two. A flag switches off ALL THREE — the block
 * is not built, the protocol never documents the channel, and
 * `features.ts → filterBlock` strips the ops anyway, since a model that read the
 * old shape out of the history window will keep emitting them for a few turns.
 *
 * Off means the fact stops existing for the narrator, not that it is hidden from
 * the player: an adventure with `quests` off keeps every quest on the board, and
 * the player still edits them by hand. What stops is the story writing them.
 *
 * Everything ships ON, so a game that never opens the screen behaves exactly as
 * it did before the screen existed. Switching the lot off leaves the narrator
 * with the player's own words — the Narrator Instructions, the Scenario, the
 * World Notes and the player character's sheet — and nothing the app invented.
 */
export interface FeatureFlags {
  /**
   * The suggested next actions under each beat. Off asks for none, renders
   * none, and never spends a repair call chasing them.
   */
  options: boolean;
  /**
   * The cast: `party` ops, the sheets they write, the PARTY roster, the roll
   * call and the keyword-gated NPC block. Off, the narrator can neither create
   * a character nor move one — the party is the player's to assemble on the
   * Characters screen. The player character's own sheet is NOT gated by this:
   * a narrator that does not know who it is narrating for is broken, not
   * simpler.
   */
  characters: boolean;
  /** Who speaks this turn — the spotlight signals, its rule, and `spoke`. */
  spotlight: boolean;
  /** The RELEVANT GEAR block: equipped items that bear on the action. */
  gear: boolean;
  /** Lasting marks on people — the `conditions` channel and its block. */
  conditions: boolean;
  /** The shared pack: `inventory` ops and the INVENTORY block. */
  inventory: boolean;
  /** The quest board: `quests` ops and the ACTIVE QUESTS block. */
  quests: boolean;
  /**
   * The narrator writing its OWN World Notes (`notes` ops). Injection of the
   * notes themselves is never gated — they are lore the player authored, and
   * they are the last thing left when everything here is off.
   */
  notes: boolean;
  /** Areas: the `area` op, the place sheets, and the authoring side call. */
  places: boolean;
  /** The scene's location name. */
  location: boolean;
  /** The scene's weather. */
  weather: boolean;
  /** Time: the `duration` op, the day counter and the phase word. */
  clock: boolean;
  /**
   * The journal. Off leaves existing entries alone: they stay on the screen and
   * return when it is switched back on.
   */
  journal: boolean;
  /**
   * On-device outcome rolls (`stakes.ts`). Off restores the pure-sandbox
   * behaviour: the narrator decides how everything goes.
   */
  stakes: boolean;
  /**
   * The post-turn op-verification gate (`verifyOps.ts`) — a cheap second
   * model call that checks specific claims a block just made — a NEW
   * character, a rename, a death/departure, an item taken — against the
   * prose that just ran, and drops or trims the ones it doesn't support. Off
   * skips the call entirely: every survives-`reconcileBlock` op applies as
   * written, same as before this existed.
   */
  opVerification: boolean;
}

export interface Settings extends ComfySettings {
  openRouterKey: string;
  /**
   * Which parts of the narrator's machinery are switched on — see
   * `FeatureFlags`. Nested rather than fourteen flat booleans because the
   * question "what is the narrator allowed to do?" has exactly one answer, and
   * `features.ts → normalizeFeatures` is the one place that answers it for a
   * stored blob written by any older build.
   */
  features: FeatureFlags;
  /**
   * Cloud sync (Menu → Cloud Sync). Off is the shipped state and the whole app
   * behaves exactly as it did before it existed — no client is constructed, no
   * request is made, nothing leaves the device.
   */
  syncEnabled: boolean;
  /**
   * Supabase project URL and ANON key. Both are public by design — they ship
   * inside every Supabase client app, and Row Level Security is what protects
   * the data — so they sit in settings like the OpenRouter key rather than in a
   * build secret. Blank falls back to the build-time `VITE_SUPABASE_*` values
   * (`supabaseClient.ts → syncConfig`), so the packaged APK works untouched and
   * a player can still point their own build at their own project.
   *
   * Per-DEVICE, deliberately: they are excluded from the settings blob that
   * syncs (`sync.ts → DEVICE_LOCAL_SETTINGS`), since a device pushing its blank
   * override would otherwise lock the other one out of the account it is
   * syncing with.
   */
  supabaseUrl: string;
  supabaseAnonKey: string;
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
  /**
   * Model for the narrow, structured side calls — op verification
   * (`verifyOps.ts`) and block repair (`store.ts`) — deliberately separate
   * from `textModelId` since neither narrates: each is "given this passage,
   * answer a specific, checkable question" rather than "write the next beat."
   * Blank falls back to `textModelId`, so an unset field never breaks either
   * of them, only makes them cost the same as narration.
   */
  cheapModelId: string;
  /**
   * Master switch for image GENERATION (Images). Off means no request ever
   * reaches the image model — no automatic portrait and no ⟳ — while
   * everything already drawn still shows, uploads still work, and nothing is
   * deleted. The one place to answer "stop buying pictures", and it lives
   * beside the image key and model it switches off.
   */
  imagesEnabled: boolean;
  temperature: number;
  /**
   * Thinking effort for the text model — narration and side calls alike. See
   * `ReasoningLevel`; `settings.ts → reasoningParam` turns it into the request
   * field (or omits it).
   */
  reasoningLevel: ReasoningLevel;
  /**
   * Whether a turn that came back with no usable machine block gets ONE repair
   * request (`loomBlock.ts → needsBlockRepair`, `prompt.ts →
   * buildRepairMessages`). Weak models drop the block — or just its `options` —
   * often enough that the alternative is a beat with no buttons and no state
   * changes at all.
   *
   * On by default, and it bills nothing on a compliant model: it fires only
   * after every read-side salvage path has failed, so a model that emits the
   * contract — or even just misplaces its options into the prose — never costs
   * a second request. A model that never complies costs one extra small call
   * per turn, which is why it is a switch rather than a constant.
   */
  repairBlock: boolean;
  /**
   * The two colors the whole app is drawn in — `--paper` behind everything,
   * `--ink` for every glyph, border and fill. They replace the old
   * `invert: boolean`, which was one point in this space (and is still one tap
   * away as a preset). Always `#rrggbb` after `settings.ts → normalizeHex`.
   *
   * `--scrim`, `color-scheme` and the browser chrome color are all derived from
   * this pair in `App.tsx`, so there is exactly one place a color is chosen.
   */
  paper: string;
  ink: string;
  /**
   * Zelda-style prose highlighting (Appearance → Colors): known character
   * names and item labels render bold in `highlightColor`; double-quoted
   * dialogue renders in `dialogueColor`. Layered on top of the ink/paper
   * pair, not a replacement for it — see `lib/highlight.ts`. Always
   * `#rrggbb` after `settings.ts → normalizeHex`.
   */
  highlightColor: string;
  dialogueColor: string;
  /**
   * The chat log's speaker name-plates (Appearance → Colors): the player's own
   * turns take `userNameColor`, and the Narrator's own beats (no party member
   * speaking) take `narratorNameColor`. A party member's own dialogue keeps the
   * neutral default — these two are about telling player/narrator apart, not a
   * per-character palette. Always `#rrggbb` after `settings.ts → normalizeHex`.
   */
  userNameColor: string;
  narratorNameColor: string;
  /**
   * Reading size for narration, in pixels. Chrome (buttons, labels) never
   * scales. Sanitized at READ time by `settings.ts → clampTextSize`.
   */
  textSize: number;
  /** Typeface for the whole app — a `FontChoice` or an added `WebFont.id`. */
  font: string;
  /** Google Web Fonts the player added by name — see `WebFont`. */
  webFonts: WebFont[];
  // Advanced (player-editable, Phase 4):
  customInstructions: string;
  /**
   * The image-prompt dialects the player has (Images → Prompt Templates). Never
   * empty — `imageTemplates.ts → normalizeImageTemplates` guarantees at least
   * the two shipped ones, since an empty picker would leave no way to word a
   * prompt and no way back.
   */
  imageTemplates: ImagePromptTemplate[];
  /**
   * Which of them every image prompt is built from. A dangling id resolves to
   * the first template rather than failing (`activeTemplate`).
   */
  imageTemplateId: string;
  /**
   * Style reference images (0–3, ordered) sent with every portrait generation.
   * Not part of a template: they are files, and the same three references are
   * what "our art style" means whichever dialect describes it.
   */
  portraitRefImages: RefImage[];
  /**
   * What the narrator must write when it introduces a character (`add`) — the
   * one moment it authors a sheet, since everything below freezes afterwards.
   */
  characterCreationInstructions: string;
  /**
   * When a character earns a NAME, and what to do when the name changes —
   * rename the one who exists rather than adding a second. The rule that stops
   * "Unnamed Goblin" and "Grik" from being two members of the same party.
   */
  namingInstructions: string;
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
  /** What the narrator does with the band it is handed — the editable half. */
  stakesRule: string;
  /**
   * The percentile-roll knobs (base chance, per-point Attribute weight,
   * Specialisation bonus, TN floor/ceiling, MIXED margin) — see
   * `AttributeRules` and `attributes.ts → normalizeAttributeRules`.
   */
  attributeRules: AttributeRules;
  /**
   * The Specialisation catalog (RPG System → Attributes & Specialisations) —
   * device-wide, like the old `DiceRules`: it describes what specialisations
   * exist in this build's rules, not anything about one adventure. A
   * character's own held set is `Character.specialisations`, referencing
   * these ids. Never empty — `attributes.ts → normalizeSpecialisations`
   * guarantees the shipped catalog when storage holds none.
   */
  specialisations: Specialisation[];
  /**
   * The GM Move catalog (RPG System → GM Moves) the narrator reaches for on a
   * Fail or a hesitant turn — see `GMMove` and `gmMoves.ts`. Gated on
   * `features.stakes`: a list of moves is meaningless without stakes existing
   * at all.
   */
  gmMoves: GMMove[];
  /**
   * Approximate token budget for the rolling history window. The only thing
   * standing between a long game and amnesia, so it is the player's to raise on
   * a large-context model.
   */
  historyBudget: number;
  /** Cap on a beat's length, in tokens. 0 sends no cap at all. */
  maxTokens: number;
  /**
   * Approximate token budget for the injected journal block. Sits beside
   * `historyBudget` because they compete for the same context, and past a
   * certain age the trade favours the journal: a summarised day is far denser
   * than the raw beats it replaces, and those beats were being evicted anyway.
   */
  journalBudget: number;
  /**
   * Turns since the last entry after which one is written regardless of the
   * clock — the fallback for a player who never sleeps.
   */
  journalMaxTurns: number;
  /**
   * Turns an interval must reach before it earns an entry. Stops a day crossed
   * on the second turn from producing a two-turn entry; the interval folds into
   * the next one instead.
   */
  journalMinTurns: number;
  /** Player-editable rule for what a journal line should be. */
  journalInstructions: string;
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
  /**
   * A RENAME: `name` is who they have been so far, `newName` is who they are
   * from now on. The one field a post-creation op may write besides
   * `standing` — a character introduced before the scene knew their name, or
   * under an alias, is the same person once the name lands, and without this
   * the narrator's only way to say so was a second `add`. The old name is kept
   * on `Character.aliases`, so ops and prose still naming them the old way keep
   * resolving. Ignored when it names somebody else who already exists.
   */
  newName?: string;
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
  /**
   * The AREA the scene is in — the town, the wood, the dungeon. Only ever
   * changes when the player travels somewhere else; a name this adventure has
   * not seen before is what triggers a place being authored.
   */
  area?: string;
  weather?: string;
  /**
   * How long this turn took, as a label off the ladder in `clock.ts`. The
   * client owns the arithmetic: it maps the label to minutes, rolls the day
   * over at midnight, and anchors `night` to the morning. See `DurationLabel`.
   */
  duration?: string;
  /**
   * @deprecated The narrator no longer sets the day — `duration` does, through
   * `clock.ts`. Two writers for one number is how it came to freeze, jump and
   * run backwards. Kept readable only because blocks recorded before the clock
   * ride inside saved messages (`Message.appliedDeltas`) and must still parse.
   */
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
