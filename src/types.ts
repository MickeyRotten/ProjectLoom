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

export interface Settings {
  openRouterKey: string;
  textModelId: string;
  imageModelId: string;
  temperature: number;
  /** When false, the narrator is not asked for action options and none render. */
  showActionOptions: boolean;
  // Advanced (player-editable, Phase 4):
  customInstructions: string;
  bannerInstructions: string;
  portraitInstructions: string;
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
