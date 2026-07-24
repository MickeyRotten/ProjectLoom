/**
 * Project Loom — on-device data model (DESIGN.md → Data Model).
 * One active GameState is autosaved continuously; named save slots (Phase 4)
 * are full snapshots of the same shape.
 */

export type Op = "add" | "update" | "remove";

export interface FieldSkill {
  name: string;
  description: string;
}

export interface Equipment {
  label: string;
  description: string;
}

export type CharacterRole = "pc" | "member";

export interface Character {
  id: string;
  role: CharacterRole;
  name: string;
  species: string;
  description: string;
  personality: string;
  drive: string;
  likes: string;
  dislikes: string;
  fieldSkill: FieldSkill;
  equipment: Equipment[];
  portraitKey?: string;
  lastSpokeTurn: number;
  inParty: boolean;
  /** When true, `customPortraitPrompt` replaces the auto-built portrait prompt. */
  useCustomPortraitPrompt?: boolean;
  /** Player-authored portrait prompt, used only when the flag above is on. */
  customPortraitPrompt?: string;
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
}

export type MessageRole = "player" | "narrator";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  turn: number;
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
 * `remove` benches, an inventory `add` merges quantity), so a turn instead
 * records exactly the mutable slices it is about to overwrite. Undo restores
 * them wholesale — exact and order-preserving. Scalars are always captured; a
 * slice is present only when the turn actually touched it, keeping most turns
 * tiny.
 */
export interface Reversal {
  day: number;
  location: string;
  weather: string;
  characters?: Character[];
  inventory?: Item[];
  quests?: Quest[];
}

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
  characters: Character[];
  worldNotes: Note[];
  inventory: Item[];
  quests: Quest[];
  messages: Message[];
  turnNumber: number;
  day: number;
  location: string;
  weather: string;
}

/** 1-bit post-process mode: Bayer ordered dither (textured) or plain 50% threshold (flat). */
export type DitherMode = "bayer4" | "threshold";

/**
 * A user-uploaded portrait style reference image. Stored inline in Settings
 * (localStorage) as base64 — uploads are downscaled client-side first so up to
 * three of them stay well under the storage quota.
 */
export interface RefImage {
  mime: string;
  b64: string;
}

export interface Settings {
  openRouterKey: string;
  /**
   * Optional separate OpenRouter key for image generation — lets the player
   * track image spend against its own key. Blank falls back to openRouterKey.
   */
  imageKey: string;
  textModelId: string;
  imageModelId: string;
  temperature: number;
  /** When false, the narrator is not asked for action options and none render. */
  showActionOptions: boolean;
  /** Flip ink/paper — the "black paper" reading of the 1-bit theme. */
  invert: boolean;
  // Advanced (player-editable, Phase 4):
  customInstructions: string;
  bannerInstructions: string;
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
  optionInstructions: string;
  spotlightRule: string;
}

/* ------------------------------------------------------------------ *
 * The <<<LOOM>>> machine-read block (loom-turn-protocol).
 * All fields optional; op-based arrays for party/inventory/quests.
 * ------------------------------------------------------------------ */

export interface PartyDelta {
  op: Op;
  name: string;
  species?: string;
  description?: string;
  fieldSkill?: FieldSkill;
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

export interface LoomBlock {
  location?: string;
  weather?: string;
  day?: number;
  options?: string[];
  party?: PartyDelta[];
  inventory?: InventoryDelta[];
  quests?: QuestDelta[];
  spoke?: string[];
}
