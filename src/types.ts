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
}

export type CharacterRole = "pc" | "member";

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
  /** Time of day, minutes since midnight. Absent on pre-clock messages. */
  minutes?: number;
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
  /** Time of day. Absent on turns recorded before the clock existed. */
  minutes?: number;
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
 * One image request, as both backends receive it. Lives here rather than in
 * `images.ts` so `comfyui.ts` can take it without importing the module that
 * dispatches into it.
 */
export interface GenerateImageOptions {
  settings: Settings;
  prompt: string;
  /**
   * Input images as data URLs — style references and/or an edit source. Sent
   * as `image_url` parts *before* the text part. OpenRouter only; the ComfyUI
   * path has no generic place to put them in a player-authored workflow.
   */
  images?: string[];
  /** e.g. "2:3" — `image_config.aspect_ratio` on OpenRouter, the latent shape on ComfyUI. */
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
 * checkpoint, sampler, size) and behaviour (`ditherMode`, `portraitRefImages`)
 * deliberately stay outside, so a template survives changing checkpoints and
 * vice versa.
 *
 * `appearanceInstructions` is in here even though it steers the TEXT model:
 * `Character.description` becomes the portrait's Subject verbatim, so a portrait
 * prompt cannot be tags while the sentence that writes its Subject asks for
 * prose.
 */
export interface ImagePromptTemplate {
  id: string;
  name: string;
  format: PromptFormat;
  /** The portrait Action/Location-context/Composition/Style clauses. Subject is auto-built from the character, never a settings field. */
  portraitAction: string;
  portraitContext: string;
  portraitComposition: string;
  portraitStyle: string;
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
 * One always-visible composer shortcut — the caption on the button and the line
 * it sends as the player's action. Shipped as LOOK · WAIT · INVESTIGATE and
 * editable behind the ✎ beside them (`QuickActionsModal`), because what counts
 * as "the thing I do every other turn" is a property of the table, not of the
 * app: a dungeon crawl wants LISTEN, a courtly game wants BOW.
 *
 * A row with a blank `label` or `input` renders no button, so the player can run
 * two shortcuts, or none.
 */
export interface QuickAction {
  label: string;
  input: string;
}

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

export interface Settings extends DiceRules, ComfySettings {
  openRouterKey: string;
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
   * Master switch for image GENERATION (Images). Off means no request ever
   * reaches the image model — no automatic portrait, no ⟳ and no ✎ — while
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
  /** When false, the narrator is not asked for action options and none render. */
  showActionOptions: boolean;
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
   * The composer's always-visible shortcuts — see `QuickAction`. Always exactly
   * `QUICK_ACTION_COUNT` entries after `settings.ts → normalizeQuickActions`, so
   * the editor can address them by index without ever growing the row.
   */
  quickActions: QuickAction[];
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
  /** How generated images are quantized to true 1-bit on-device. */
  ditherMode: DitherMode;
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
   * The tilt of the surface the dice land on, in degrees — pitch is the tip
   * toward or away from the viewer, yaw the turn to one side. Shipped a few
   * degrees off square (`diceAnim.ts → SCENE_TILT`), which is enough to show a
   * landed cube has sides; the player owns it because "how much 3D" is taste,
   * and 0/0 is a perfectly reasonable answer.
   */
  dicePitch: number;
  diceYaw: number;
  /**
   * Draw the dice with a vanishing point. On, a die's distance from the middle
   * of the screen shows in it — the ones off to the side turn their faces
   * slightly away. Off is an orthographic view: every die is drawn identically
   * wherever it sits, which is flatter but perfectly even.
   */
  dicePerspective: boolean;
  /**
   * Approximate token budget for the rolling history window. The only thing
   * standing between a long game and amnesia, so it is the player's to raise on
   * a large-context model.
   */
  historyBudget: number;
  /** Cap on a beat's length, in tokens. 0 sends no cap at all. */
  maxTokens: number;
  /**
   * Whether the journal exists at all — writing entries and injecting them.
   * Off leaves existing entries alone: they stay on the screen and return when
   * it is switched back on.
   */
  journalEnabled: boolean;
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
