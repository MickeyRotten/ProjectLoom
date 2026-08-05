import { create } from "zustand";
import type {
  AdventureImports,
  Arc,
  AreaCard,
  RoomCard,
  Character,
  CharacterOverride,
  DiceCast,
  Equipment,
  GameState,
  Item,
  JournalLine,
  Message,
  Note,
  Quest,
  Scenario,
  Settings,
  Standing,
} from "./types";
import { ensureGold, newCharacter, newGame, seedAdventure, withPC } from "./lib/defaults";
import { loadSettings, saveSettings } from "./lib/settings";
import {
  currentAccount,
  signIn as authSignIn,
  signOut as authSignOut,
  signUp as authSignUp,
  syncConfigured,
  type Account,
} from "./lib/supabaseClient";
import {
  purgeRemoteImages,
  runSync,
  startSync,
  stopSync,
  type SyncPorts,
  type SyncStatus,
} from "./lib/syncEngine";
import { downloadWebFont, mountWebFonts, unmountWebFont } from "./lib/webFonts";
import {
  loadActiveGame,
  loadLegacyCharacters,
  saveActiveGame,
  listImageKeys,
  loadImage,
  saveImage,
  deleteImage,
  copyImage,
  deleteImagesWithPrefix,
  promoteLegacyMasters,
  saveSlot,
  loadSlot,
  readSlot,
  deleteSlot,
  listSlots,
  type SaveSlot,
} from "./lib/db";
import {
  activeMembers,
  clearOverrides as clearRosterOverrides,
  dropEntry,
  getEntry,
  isInParty,
  mergeLibrary,
  mergeOverrides,
  partyFull,
  partyMembers,
  playerCharacter,
  pruneRoster,
  resolve,
  setCondition as setEntryCondition,
  setEntry,
  setStanding as setEntryStanding,
  standingOf,
} from "./lib/roster";
import { equipItem as moveToKit, unequipItem as moveToPack, type Move } from "./lib/equip";
import { computeStakes, previewRoll, rollRecord, stakeRules } from "./lib/stakes";
import { BLOCK_REPAIR_TEMPERATURE, buildMessages, buildRepairMessages } from "./lib/prompt";
import { completeChat, streamChat, OpenRouterError } from "./lib/openrouter";
import {
  AUTO_UPDATE_TEMPERATURE,
  buildAutoUpdateMessages,
  normalizeFields,
  parseAutoUpdate,
  type AutoField,
} from "./lib/autoUpdate";
import {
  GENERATE_FIELD_TEMPERATURE,
  buildFieldMessages,
  parseGeneratedField,
  type GenField,
} from "./lib/generateField";
import {
  GENERATE_SCENARIO_TEMPERATURE,
  buildScenarioMessages,
  type ScenarioField,
} from "./lib/generateScenario";
import {
  GENERATE_ITEM_TEMPERATURE,
  buildItemMessages,
  parseGeneratedItem,
  type GeneratedItem,
  type ItemRow,
} from "./lib/generateItem";
import {
  mergeRepairBlock,
  needsBlockRepair,
  normalizeOptions,
  parseLoomResponse,
  truncateForDisplay,
} from "./lib/loomBlock";
import { applyDeltas, reconcileBlock } from "./lib/deltas";
import { withRename } from "./lib/names";
import {
  JOURNAL_TEMPERATURE,
  appendModelLines,
  buildJournalMessages,
  openJournalEntry,
  parseJournalLines,
} from "./lib/journal";
import { captureReversal, applyReversal } from "./lib/reversal";
import { detectSpeakers } from "./lib/spotlight";
import {
  ARC_TEMPERATURE,
  buildArcMessages,
  handOff,
  parseArc,
  rewriteArc,
  runningArc,
} from "./lib/arc";
import {
  AREA_PREP_TEMPERATURE,
  areaChanged,
  buildAreaMessages,
  parseAreaCard,
  stampAreaCard,
  type ParsedAreaCard,
} from "./lib/areaPrep";
import {
  ROOM_PREP_TEMPERATURE,
  buildRoomMessages,
  parseRoomCard,
  roomChanged,
  stampRoomCard,
  type ParsedRoomCard,
} from "./lib/roomPrep";
import {
  addRoom,
  applyExits,
  roomKey,
  seedRooms,
  seedStartingArea,
  visitRoom,
} from "./lib/gazetteer";
import { closeInterlude, normalizeForesight, reckonTurn, seedArcs } from "./lib/foresight";
import {
  imagesAllowed,
  buildPortraitPrompt,
  generateImage,
  MAX_IMAGE_SIDE,
  portraitKey,
  refImageToDataUrl,
  slotArtPairs,
  slotArtPrefixes,
  toStoredImage,
  type GenerateImageOptions,
} from "./lib/images";
import { activeTemplate } from "./lib/imageTemplates";
import { imageFileName, saveBlobAsFile } from "./lib/download";

/** Per-turn knobs — everything about a turn that isn't the player's action. */
export interface SendTurnOptions {
  /**
   * The player's note for a regeneration (↻ Regen → Note). Rides the prompt as
   * direction to the narrator and nothing else: it is not part of the action,
   * so it never enters the transcript, the history, or the seed the stakes roll
   * is drawn from.
   */
  note?: string;
  /**
   * Which action BUTTON the player pressed, if they pressed one. The narrator
   * may have written a note for that option last turn (`Message.optionNotes`),
   * and this is how it is matched back — by index, because the note was written
   * for the option rather than for its wording. A typed or edited action passes
   * nothing and correctly gets no note.
   */
  optionIndex?: number;
}

/** Per-call knobs for the shared cache-then-generate image helper. */
interface EnsureImageOptions {
  /**
   * Publish a cached blob if there is one, but never hit the network — image
   * generation being switched off (Images) rides on this.
   */
  cacheOnly?: boolean;
}

/** Full-screen overlay currently shown over the chat. */
export type Screen =
  | null
  | "menu"
  | "narrator"
  | "images"
  | "scenario"
  | "characters"
  | "worldnotes"
  | "journal"
  | "quests"
  | "rpg"
  | "appearance"
  | "saves"
  | "sync"
  | "party"
  | "inventory"
  | "member"
  /** This adventure's forward prep — arc, area, room, promises. */
  | "foresight"
  /** The 1-bit map. A PLAY screen: the threats stay private on Foresight. */
  | "map";

export interface LoomStore {
  settings: Settings;
  game: GameState;
  hydrated: boolean;

  // Turn/streaming state
  streaming: boolean;
  streamText: string;
  options: string[];
  error: string | null;
  /** The input of the last failed/stopped turn, so it can be retried verbatim. */
  failedInput: string | null;
  /**
   * The roll currently being thrown across the screen (`DiceOverlay`), staged
   * the moment the dice are known — while the turn is still streaming. Purely
   * presentational and never persisted: the turn's authoritative record is
   * `Message.roll`.
   */
  dice: DiceCast | null;

  // UI
  screen: Screen;
  /** Screens navigated away from — Back pops this so it returns to wherever
   *  you actually came from, not a hard-coded parent. */
  history: Screen[];
  /** The member whose full-screen sheet is open (screen === "member"). */
  memberId: string | null;
  /**
   * A sub-menu a `SubMenuScreen` should open itself at — the one-shot half of a
   * deep link. Set by `setScreen(screen, section)`, consumed and cleared by the
   * screen on arrival, so a later plain visit lands on the index. Deliberately
   * a bare string rather than a union: every screen names its own sections, and
   * an id that doesn't match one is simply ignored.
   */
  section: string | null;
  /**
   * A screen's claim on Back, for screens with internal depth. Returning true
   * means "handled, don't leave the screen". Registered here rather than passed
   * to the header so the hardware back button obeys it too.
   */
  backHandler: (() => boolean) | null;

  // Generated images (Phase 3): cache key → object URL, plus in-flight keys.
  images: Record<string, string>;
  imgPending: Record<string, boolean>;
  /**
   * Keys whose last player-driven image action failed → why it failed. Surfaced
   * as a small indicator plus the reason, cleared on retry. The reason matters:
   * "image failed" alone is unactionable, and the causes are wildly different
   * (no credit, a refused prompt, an unreadable file).
   */
  imgError: Record<string, string>;

  // Named save slots (Phase 4).
  slots: SaveSlot[];

  /** A character-sheet auto-update is in flight (one at a time, app-wide). */
  autoUpdating: boolean;
  /** Why the last auto-update failed, shown in the modal until dismissed. */
  autoUpdateError: string | null;

  /** A per-field character generation is in flight (one at a time, app-wide). */
  fieldGenPending: boolean;
  /** Why the last field generation failed, shown in the modal until dismissed. */
  fieldGenError: string | null;

  /**
   * A Foresight boundary call is in flight — area prep, room prep or the arc
   * handoff. Shown on the Foresight screen and nowhere else: these calls are
   * off the critical path by construction, so the turn must never wait on one
   * or even look like it is.
   */
  foresightPending: boolean;
  /** Why the last boundary call failed. Cleared on the next attempt. */
  foresightError: string | null;

  hydrate: () => Promise<void>;
  /**
   * Open an overlay, optionally deep-linking to one of its sub-menus. The
   * section is what lets a cross-reference be a button instead of a sentence
   * telling the player which path to walk.
   */
  setScreen: (screen: Screen, section?: string) => void;
  /** Return to the previous screen (pops the navigation history). */
  goBack: () => void;
  /** Drop a consumed deep-link section so a later plain visit lands on the index. */
  clearSection: () => void;
  /** Claim Back for a screen with internal depth; pass null to release it. */
  setBackHandler: (handler: (() => boolean) | null) => void;
  openMember: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;

  /** True while a Google Web Font is downloading (Appearance → Font → Add). */
  fontPending: boolean;
  /** Why the last Add failed, in the player's words. Cleared on the next try. */
  fontError: string | null;
  /**
   * Download a Google Web Font by name, store its files on device and select
   * it. Single-flight on `fontPending`, like the ✦ generators — the screen has
   * one Add button and one error line, so a second concurrent download would
   * have nowhere to report.
   */
  addWebFont: (name: string) => Promise<void>;
  /** Forget an added font, falling the selection back if it was the active one. */
  removeWebFont: (id: string) => Promise<void>;

  // Authoring (Phase 4) — every edit mutates the active game, autosaved.
  updateScenario: (patch: Partial<Scenario>) => void;
  /**
   * Player-authored edit: writes the authored character sheet, and drops any story
   * override on the fields touched so the player's own text wins immediately.
   */
  updateCharacter: (id: string, patch: Partial<Character>) => void;
  /** Create a blank character in the library (NOT in the party) and return its id. */
  addCharacter: () => string;
  /**
   * Ask the text model to rewrite the selected sheet fields for one character
   * (Appearance / Personality / Drive) and apply the result. Resolves true when
   * something was written.
   */
  autoUpdateCharacter: (id: string, fields: AutoField[]) => Promise<boolean>;
  /** Clear a stale auto-update failure (modal close / new run). */
  clearAutoUpdateError: () => void;
  /**
   * Ask the text model to write ONE sheet field from scratch, for the ✦ button
   * beside it. Resolves to the generated text, or null on failure (the reason
   * lands in `fieldGenError`).
   *
   * Takes the character by VALUE, not by id: the sheet is in edit mode when this
   * runs, so the version that matters is the on-screen draft. Writes nothing —
   * the caller previews the text and puts it in the draft.
   */
  generateField: (
    character: Character,
    field: GenField,
    hint: string,
  ) => Promise<string | null>;
  /**
   * Ask the text model to write ONE scenario field (Premise / Opening
   * Narration) for the ✦ button beside it. Same shape as `generateField` — no
   * writes, the text comes back for the modal to preview — and it shares the
   * `fieldGenPending` / `fieldGenError` pair, since only one generate modal can
   * be open at a time in either place.
   */
  generateScenarioField: (field: ScenarioField, hint: string) => Promise<string | null>;
  /**
   * Ask the text model to write ONE inventory / equipment row for the ✦ button
   * beside it. Same shape as its two siblings — no writes, the row comes back
   * for the modal to preview, and it shares the `fieldGenPending` /
   * `fieldGenError` pair — except that it resolves to three values at once,
   * since a label without its description is half an item.
   *
   * `existing` is the list being added to WITHOUT the row being written, and
   * `character` is set only for a character's kit (as shown on screen — the
   * sheet's edit draft), never for the shared pack.
   */
  generateItem: (
    hint: string,
    existing: ItemRow[],
    character?: Character,
  ) => Promise<GeneratedItem | null>;
  /** Clear a stale field-generation failure (modal close / new run). */
  clearFieldGenError: () => void;
  /** Delete a character from the library entirely (and from every adventure). */
  removeCharacter: (id: string) => void;
  /**
   * Move a character along this adventure's standing ladder — into the party
   * (`active`, capped at PARTY_LIMIT), onto the bench, to an NPC ally, out of
   * the party entirely (`none` — what Kick does), or out of the story
   * (`departed` / `fallen`). Never touches the character's sheet.
   */
  setStanding: (id: string, standing: Standing) => void;
  /** Set or clear this adventure's mark on a character (blank clears). */
  setCondition: (id: string, condition: string) => void;
  /** Drop this adventure's story-written overrides, back to the authored sheet. */
  revertOverrides: (id: string) => void;
  addNote: () => void;
  updateNote: (id: string, patch: Partial<Note>) => void;
  removeNote: (id: string) => void;
  addQuest: () => void;
  updateQuest: (id: string, patch: Partial<Quest>) => void;
  removeQuest: (id: string) => void;
  setQuests: (quests: Quest[]) => void;
  addItem: () => void;
  updateItem: (index: number, patch: Partial<Item>) => void;
  removeItem: (index: number) => void;
  setInventory: (inventory: Item[]) => void;
  /**
   * Hand a pack row to the PC or a party member — the whole row, count and
   * all, off `game.inventory` and onto `Character.equipment`. A MOVE: the item
   * is never in both places (see `equip.ts`). No-op on Gold, on a blank row, or
   * on a character the library doesn't have.
   */
  equipItem: (index: number, characterId: string) => void;
  /** The reverse — a kit row back into the shared pack, merging by label. */
  unequipItem: (characterId: string, index: number) => void;

  /* --- Cloud saves (Menu → Cloud Saves) --- */
  /** The signed-in account, or null when signed out / sync off. */
  account: Account | null;
  syncStatus: SyncStatus;
  /** True while a sign-in / sign-up call is in flight. */
  authPending: boolean;
  /** Why the last auth attempt failed, in the player's words. */
  authError: string | null;
  /** Set after a sign-up that needs an email confirmation before it can sign in. */
  authNotice: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Sync now, from the button. No-op when signed out. */
  syncNow: () => Promise<void>;
  /** Turn sync on/off — off stops the engine and touches nothing stored. */
  setSyncEnabled: (on: boolean) => void;
  clearAuthError: () => void;

  // Save slots (Phase 4) — snapshot / restore / delete of the active game.
  refreshSlots: () => Promise<void>;
  snapshotSlot: (name: string) => Promise<void>;
  /** Re-snapshot the active game into an existing slot, keeping its name. */
  overwriteSlot: (id: string) => Promise<void>;
  restoreSlot: (id: string) => Promise<void>;
  dropSlot: (id: string) => Promise<void>;

  /**
   * Replace the active game with a fresh one, carrying over exactly what the
   * player ticked in the New Adventure dialog (`AdventureImports`). Nothing is
   * implicit any more — the cast is part of the adventure being thrown away.
   */
  newAdventure: (imports: AdventureImports) => void;
  sendTurn: (text: string, opts?: SendTurnOptions) => Promise<void>;
  /** Re-send the input of the last failed turn. */
  retryTurn: () => void;
  /** Abort the in-flight turn; the input rolls back and becomes retryable. */
  stopTurn: () => void;
  /**
   * End the dice toss — on its own timer, or on a tap that skips it. Takes the
   * cast's id so a timer belonging to a finished throw cannot clear the throw
   * that replaced it.
   */
  clearDice: (id: string) => void;
  /**
   * Throw the configured dice with nothing at stake (RPG System → Test Roll):
   * a look at the system the player has just tuned, recorded nowhere.
   */
  testRoll: () => void;

  // Reversal (Phase 5) — unwind the latest turn's applied deltas.
  /** Drop the latest turn (player + narrator), restoring pre-turn scene state. */
  undoLastTurn: () => void;
  /**
   * Re-run the latest turn's player input for a fresh narration (swipe). An
   * optional `note` is the player's direction for the retelling ("shorter",
   * "let her refuse"); without one this is the plain re-roll it always was.
   */
  regenerateLastTurn: (note?: string) => void;
  /** Overwrite one message's prose in place (edit the latest narration). */
  editMessage: (id: string, content: string) => void;
  /** Edit the latest player input: unwind the turn, then re-send the new text. */
  editUserTurn: (text: string) => void;

  /** A journal entry's written lines are being fetched. */
  journalPending: boolean;
  /**
   * Fetch and append an entry's written lines. Fired after a turn opens one,
   * and from the Journal screen when a call failed or the player wants it
   * rewritten. The entry already exists with its facts, so this is never on the
   * turn's critical path and its failure is never a turn error.
   */
  writeJournalEntry: (id: string, replace?: boolean) => Promise<void>;
  /** Replace an entry's lines wholesale (Journal screen editing). */
  updateJournalEntry: (id: string, lines: JournalLine[]) => void;
  /** Delete an entry outright. */
  deleteJournalEntry: (id: string) => void;

  /* ------------------------- Foresight ------------------------- */

  /**
   * Prep whatever the scene now needs — the region, this room, and the rooms
   * its exits name. Fire-and-forget, called after a turn lands and after a
   * restore; never awaited by anything, since a card that arrives late simply
   * makes the NEXT turn better and a card that never arrives leaves the turn
   * byte-identical to one taken with the feature off.
   */
  prepForesight: () => void;
  /**
   * ✦ on the Foresight screen: write this region's card again, with the
   * player's guidance. Resolves to the card for the modal to preview, or null
   * on failure (the reason lands in `fieldGenError`) — it writes NOTHING, so
   * the region in play is untouched until `applyAreaCard`.
   *
   * Shares `fieldGenPending` / `fieldGenError` with the other ✦ flows rather
   * than using `foresightPending`: one generate modal is open at a time
   * app-wide, and `foresightPending` means "a boundary call the player did not
   * ask for is in flight".
   */
  generateAreaCard: (hint: string) => Promise<ParsedAreaCard | null>;
  /** **Use This** on a generated region card: stamp it and put it in play. */
  applyAreaCard: (parsed: ParsedAreaCard) => void;
  /** ✦ for this room — `generateAreaCard`'s twin, one scope down. */
  generateRoomCard: (hint: string) => Promise<ParsedRoomCard | null>;
  /** **Use This** on a generated room card. */
  applyRoomCard: (parsed: ParsedRoomCard) => void;
  /** Edit this region's written material by hand (texture, standing threats). */
  updateArea: (patch: Partial<Pick<AreaCard, "texture" | "threats">>) => void;
  /**
   * Edit this room's card by hand. Creates the card if the room has never been
   * prepped, so a player can author a place the model has never seen — the same
   * bargain the Journal and World Notes screens make.
   */
  updateRoom: (patch: Partial<Omit<RoomCard, "version" | "openedTurn">>) => void;
  /**
   * Ask for an arc, staged rather than applied (`Arc.staged`). Runs when an
   * interlude begins, and again behind the screen's ✦ — which now also reaches
   * a RUNNING arc, where the staged template replaces the chapter in hand
   * instead of opening the next one.
   */
  stageNextArc: (force?: boolean) => Promise<void>;
  /**
   * **Use This** on the staged arc. In an interlude that closes the current
   * chapter and opens the staged one beside it (`handOff`); on a running arc it
   * REPLACES the chapter in hand, keeping its seat (`rewriteArc`).
   */
  applyStagedArc: () => void;
  /** Throw away the staged arc without using it. */
  discardStagedArc: () => void;
  /** *Move on* — end the interlude by hand rather than waiting it out. */
  endInterlude: () => void;
  /** Edit the running arc (question, the front's steps, manual ticks). */
  updateArc: (patch: Partial<Arc>) => void;
  /** Drop one outstanding promise — the player closing it off by hand. */
  closePromise: (id: string) => void;
  clearForesightError: () => void;

  /** Ensure the PC + all in-party portraits exist (cache-then-generate). */
  syncImages: () => void;
  /** Ensure one member's portrait exists (used when a sheet opens). */
  ensurePortrait: (memberId: string) => void;
  /** Force-regenerate, replacing the cached blob. */
  regeneratePortrait: (memberId: string) => void;
  /** Replace a member's portrait with a user-supplied image file. */
  uploadPortrait: (memberId: string, file: Blob) => Promise<void>;
  /**
   * Drop a member's portrait entirely — the cached image, and the automatic
   * re-generation that would otherwise put one straight back.
   */
  removePortrait: (memberId: string) => void;
  /**
   * Save a member's portrait to the device (share sheet / download). Resolves
   * false when there was nothing to save or the platform refused, so the sheet
   * can say so — a failed SAVE must not flag the portrait itself as broken.
   */
  downloadPortrait: (memberId: string) => Promise<boolean>;
  /**
   * Delete every stored picture from this device, and from the cloud when
   * signed in (Images → Stored Images).
   *
   * Wholesale, unlike the member sheet's Remove Image: this is for reclaiming
   * the space a long game's art takes, or for throwing away a style the player
   * has just replaced. It leaves no `noPortrait` flag behind, so the
   * deterministic triggers redraw what they normally would.
   */
  purgeImages: () => Promise<PurgeSummary>;
}

/** What one purge deleted, for the line the screen shows afterwards. */
export interface PurgeSummary {
  /** Blobs deleted from this device. */
  local: number;
  /** Objects deleted from the cloud (0 when signed out). */
  remote: number;
  /** Cloud objects that refused to go — the next sync retries them. */
  failed: number;
  /** Set when the cloud could not be reached at all; local deletion still happened. */
  error: string | null;
}

/** The sheet fields the story is allowed to diverge from the base character. */
const OVERRIDABLE: (keyof CharacterOverride)[] = [
  "species",
  "sex",
  "description",
  "personality",
  "drive",
  "strengths",
  "flaws",
];

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useStore = create<LoomStore>((set, get) => {
  /**
   * Expose a blob under `key` as an object URL in `images`, revoking whatever
   * URL it replaces — every image path (generate / edit / upload) ends here.
   */
  function publishImage(key: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const prev = get().images[key];
    if (prev) URL.revokeObjectURL(prev);
    set({ images: { ...get().images, [key]: url } });
  }

  /** Drop `key` out of the in-flight set. */
  function clearPending(key: string) {
    const imgPending = { ...get().imgPending };
    delete imgPending[key];
    set({ imgPending });
  }

  /** Flag (with a reason) or clear the "image failed" indicator for one key. */
  function setImageError(key: string, reason: string | null) {
    const imgError = { ...get().imgError };
    if (reason) imgError[key] = reason;
    else delete imgError[key];
    set({ imgError });
  }

  /** What to show the player for a thrown image failure. */
  function imageFailure(err: unknown): string {
    return err instanceof Error && err.message ? err.message : "Image request failed.";
  }

  /**
   * Freeze the cast's art under one slot's keys — the copy that makes a
   * snapshot's portraits its own (`images.ts → slotArtPairs`). Best-effort per
   * blob: art is a cache, and a snapshot must not fail because a picture could
   * not be duplicated.
   */
  async function freezeSlotArt(slotId: string, game: GameState): Promise<void> {
    for (const art of slotArtPairs(slotId, game.characters)) {
      try {
        await copyImage(art.live, art.slot);
      } catch {
        // See above — a missing frozen copy falls back to the live art.
      }
    }
  }

  /** Delete every blob one slot froze (overwritten, or deleted outright). */
  async function dropSlotArt(slotId: string): Promise<void> {
    for (const prefix of slotArtPrefixes(slotId)) {
      try {
        await deleteImagesWithPrefix(prefix);
      } catch {
        // Orphaned blobs are wasted bytes, never a broken save.
      }
    }
  }

  /**
   * Put a slot's frozen art back on the live keys, and on screen.
   *
   * Per character, not per blob. A slot with no frozen copy for someone — one
   * taken before snapshots carried art, or a cloud slot whose blobs have not
   * arrived — leaves that character's live art exactly as it is, which is the
   * behaviour every existing save was made under.
   *
   * Publishing here rather than leaving it to `syncImages` is deliberate —
   * `ensureImage` returns early when the key already has an object URL, so the
   * restored blob would sit in IndexedDB behind the picture it replaced.
   */
  async function thawSlotArt(slotId: string, game: GameState): Promise<void> {
    for (const art of slotArtPairs(slotId, game.characters)) {
      try {
        const frozen = await loadImage(art.slot);
        if (!frozen) continue;
        await saveImage(art.live, frozen);
        publishImage(art.live, frozen);
        setImageError(art.live, null);
      } catch {
        // A picture that could not be restored leaves the live one in place.
      }
    }
  }

  /**
   * Cache-then-generate an image blob under `key`, exposing it as an object URL
   * in `images`. A fresh generation is only bounded to `MAX_IMAGE_SIDE` before
   * it is cached — what the model drew is what is stored and shown.
   * `force` skips the cache and regenerates, replacing whatever was there —
   * generated or uploaded. Fire-and-forget: every failure is swallowed so an
   * image never blocks a turn.
   */
  async function ensureImage(
    key: string,
    buildRequest: () => Pick<GenerateImageOptions, "prompt" | "images" | "aspectRatio">,
    force = false,
    opts: EnsureImageOptions = {},
  ): Promise<void> {
    if (get().imgPending[key]) return;
    if (!force && get().images[key]) return;

    // Nothing may be drawn (generation switched off): probe the cache and stop
    // there. Deliberately ahead of `imgPending` — flagging a generation that
    // can't happen would blink "rendering…" under every suppressed portrait.
    if (opts.cacheOnly && !force) {
      const cached = await loadImage(key);
      if (cached) publishImage(key, cached);
      return;
    }

    set({ imgPending: { ...get().imgPending, [key]: true } });
    // A forced run is the player pressing ⟳ — clear any stale failure so the
    // indicator reflects THIS attempt.
    if (force) setImageError(key, null);
    try {
      const cached = force ? null : await loadImage(key);
      if (cached) {
        publishImage(key, cached);
        return;
      }
      const raw = await generateImage({ settings: get().settings, ...buildRequest() });
      const blob = await toStoredImage(raw);
      await saveImage(key, blob);
      publishImage(key, blob);
    } catch (err) {
      // Non-fatal — a failed image never blocks the turn (DESIGN.md) — but it
      // is never SILENT either. Recording the reason on the automatic path too
      // is what separates "no image model credit" from an eternal placeholder
      // the player has no way to explain; before, the reason only appeared if
      // they happened to press ⟳. The badge is small and dismissible; guessing
      // is not.
      setImageError(key, imageFailure(err));
    } finally {
      clearPending(key);
    }
  }

  /** Abort handle for the in-flight turn (closure state — not reactive). */
  let turnAbort: AbortController | null = null;

  /* ------------------------------------------------------------------ *
   * Foresight — the boundary calls (DESIGN.md → Foresight).
   *
   * Every one of them is OFF the critical path: nothing here is ever awaited
   * by a turn, every failure is swallowed, and a card that arrives late or not
   * at all leaves the next turn exactly as it would have been without the
   * feature. That is what makes "extra calls per turn: zero" true.
   * ------------------------------------------------------------------ */

  /** One prep chain at a time, app-wide. Closure state, not reactive. */
  let prepRunning = false;

  /** Write one Foresight slice of the game and save, in one place. */
  function commitForesight(patch: Partial<GameState>) {
    const game = { ...get().game, ...patch };
    set({ game });
    void saveActiveGame(game);
  }

  /**
   * Prep one region. The staleness guard is the whole reason the arc is read
   * twice: a card authored under an arc that has since moved describes a world
   * the player has already left, and applying it would cache exactly the thing
   * `Arc.epoch` exists to invalidate.
   */
  async function prepArea(key: string, force: boolean): Promise<void> {
    const settings = get().settings;
    const game = get().game;
    const arc = runningArc(game.arcs);
    if (!force && !areaChanged(game, key, arc)) return;

    const card = (game.areas ?? {})[key];
    const name = card?.name || game.location;
    const raw = await completeChat({
      settings,
      messages: buildAreaMessages(settings, game, name, arc, game.promises ?? []),
      temperature: AREA_PREP_TEMPERATURE,
    });
    const parsed = parseAreaCard(raw);
    if (!parsed) return;

    const now = get().game;
    const nowArc = runningArc(now.arcs);
    // Landed for an arc that has moved on: dropped, exactly as a journal entry
    // is dropped when its id is gone.
    if ((nowArc?.id ?? "") !== (arc?.id ?? "") || (nowArc?.epoch ?? 0) !== (arc?.epoch ?? 0)) {
      return;
    }

    commitAreaCard(key, parsed);
  }

  /**
   * Stamp a parsed area card and put it in play — the half of `prepArea` that
   * writes, shared with the Foresight screen's ✦, whose staleness question was
   * answered by the player pressing **Use This**.
   */
  function commitAreaCard(key: string, parsed: ParsedAreaCard): void {
    const now = get().game;
    const arc = runningArc(now.arcs);
    const previous = (now.areas ?? {})[key];
    const name = previous?.name || now.location;

    let stamped = stampAreaCard(parsed, key, name, arc, previous);
    // The room list is a SEED: names only, no cards, and the ones nobody has
    // walked into survive a re-prep because a rumour is a hook.
    stamped = seedRooms(stamped, parsed.rooms);
    // The player is standing in one of them right now, whether it was listed or
    // not — an unlisted room is the ordinary case, not an error.
    if (now.areaKey === key) stamped = visitRoom(stamped, now.location);

    commitForesight({ areas: { ...(now.areas ?? {}), [key]: stamped } });
  }

  /**
   * Prep one room inside a prepped region. `location` rather than "the current
   * room" on purpose: this is also the prefetch path, and the rooms it preps
   * are ones the player has not walked into yet.
   */
  async function prepRoom(areaKey: string, location: string, force: boolean): Promise<void> {
    const settings = get().settings;
    const game = get().game;
    const area = (game.areas ?? {})[areaKey];
    if (!area) return;

    const key = roomKey(location);
    if (!key) return;
    const room = area.rooms[key];
    if (!force && !roomChanged(area, room, game.turnNumber, settings.sceneBoundaryTurns)) return;

    const raw = await completeChat({
      settings,
      messages: buildRoomMessages(
        settings,
        game,
        room?.name || location,
        area,
        activeMembers(game.characters, game.roster),
        game.promises ?? [],
      ),
      temperature: ROOM_PREP_TEMPERATURE,
    });
    const parsed = parseRoomCard(raw);
    if (!parsed) return;

    const now = get().game;
    const nowArea = (now.areas ?? {})[areaKey];
    // Its region was re-prepped while this was in flight, so the card was
    // written against a version of the place that no longer exists.
    if (!nowArea || nowArea.version !== area.version) return;

    commitRoomCard(areaKey, room?.name || location, parsed);
  }

  /**
   * Stamp a parsed room card and put it in play — `commitAreaCard`'s twin, and
   * the half of `prepRoom` the Foresight screen's ✦ shares.
   */
  function commitRoomCard(areaKey: string, location: string, parsed: ParsedRoomCard): void {
    const now = get().game;
    const nowArea = (now.areas ?? {})[areaKey];
    if (!nowArea) return;
    const key = roomKey(location);
    if (!key) return;

    let next = addRoom(nowArea, location);
    const slot = next.rooms[key];
    if (!slot) return;
    next = {
      ...next,
      rooms: { ...next.rooms, [key]: { ...slot, card: stampRoomCard(parsed, nowArea, now.turnNumber) } },
    };
    // The exits are what make prefetch possible: the neighbours of a room are
    // known the moment its card lands, so their cards can be waiting.
    next = applyExits(next, key, parsed.exits);

    commitForesight({ areas: { ...(now.areas ?? {}), [areaKey]: next } });
  }

  /**
   * The chain, in the order the player will meet it: the region, the room they
   * are standing in, then the rooms its exits name.
   *
   * The prefetch is the answer to a timing problem rather than a nicety: entry
   * is only known when the block lands, so a card requested on arrival is ready
   * for the SECOND beat in a room — and the entering beat is the one worth
   * prepping. Immediate neighbours only, never deeper, and bounded by
   * `ROOM_MAX_EXITS` rather than by a cap of its own.
   */
  async function runPrep(): Promise<void> {
    if (prepRunning) return;
    const settings = get().settings;
    if (!settings.foresightEnabled) return;

    const arc = runningArc(get().game.arcs);
    // An interlude has nothing to prep — every clock is suspended and the block
    // is replaced by breathing room. What it DOES have is a handoff to stage.
    if (arc?.status === "interlude") {
      if (!arc.staged) void get().stageNextArc();
      return;
    }

    const areaKey = get().game.areaKey;
    if (!areaKey) return;

    prepRunning = true;
    // Only when there is something to clear: this runs after every turn, and an
    // unconditional `set` would re-render the screens watching it on each one.
    if (get().foresightError) set({ foresightError: null });
    try {
      await prepArea(areaKey, false);
      await prepRoom(areaKey, get().game.location, false);

      const area = (get().game.areas ?? {})[areaKey];
      const here = area?.rooms[roomKey(get().game.location)];
      for (const exit of here?.exits ?? []) {
        const neighbour = area?.rooms[exit];
        if (!neighbour || neighbour.card) continue;
        await prepRoom(areaKey, neighbour.name, false);
      }
    } catch (err) {
      // Never a turn error, and never thrown: a failed prep is the documented
      // "no card → the turn is byte-identical to today" row of the failure
      // table. It is recorded only so the Foresight screen can say why.
      set({ foresightError: err instanceof Error ? err.message : "Prep failed." });
    } finally {
      prepRunning = false;
    }
  }

  /**
   * Write the cast. It is a slice of the game document like any other now, so
   * this exists for the same reason `setEntry` does: one place that both `set`s
   * and saves, rather than thirty call sites remembering to do both.
   */
  function commitCharacters(characters: Character[]) {
    const game = { ...get().game, characters };
    set({ game });
    void saveActiveGame(game);
  }

  /**
   * Apply one gear move — pack ⇄ one character's kit — writing BOTH halves.
   *
   * `equip.ts` computes both new arrays or returns null; this writes both or
   * neither. They used to live in different stores, which made an item mid-move
   * the one moment it could be duplicated or dropped; now that the cast is part
   * of the game document it is a single write, and the invariant holds by
   * construction rather than by care.
   */
  function moveGear(
    characterId: string,
    move: (inventory: Item[], equipment: Equipment[]) => Move | null,
  ) {
    const game = get().game;
    const character = game.characters.find((c) => c.id === characterId);
    if (!character) return;
    const moved = move(game.inventory, character.equipment);
    if (!moved) return;

    // Both halves now live in the same document, so the move is one write —
    // there is no longer a moment where the item could be in both places or
    // neither, whatever happens between the two saves.
    const next: GameState = {
      ...game,
      inventory: moved.inventory,
      characters: game.characters.map((c) =>
        c.id === characterId ? { ...c, equipment: moved.equipment } : c,
      ),
    };
    set({ game: next });
    void saveActiveGame(next);
  }

  /**
   * Everything cloud saves are allowed to touch, in one place (`syncEngine.ts →
   * SyncPorts`). Built fresh on each start so the closures read live state.
   *
   * A short list, and that is the headline: the game being played is not on it.
   * Adopting pulled data goes through the SAME writers a player edit does —
   * `saveSlot`, `saveSettings` — rather than poking `set` and leaving the disk
   * copy behind. The engine suppresses its own notifications while adopting, so
   * this cannot echo.
   */
  function syncPorts(): SyncPorts {
    return {
      settings: () => get().settings,
      account: () => get().account,
      adoptSettings(settings) {
        saveSettings(settings);
        set({ settings });
        void mountWebFonts(settings.webFonts);
      },
      slotsChanged() {
        void get().refreshSlots();
      },
      onStatus(syncStatus) {
        set({ syncStatus });
      },
    };
  }

  /**
   * Pick up an existing session and start the engine. Called on hydrate and
   * after a sign-in; silent when sync is off or unconfigured, since that is the
   * shipped state and not a failure.
   */
  async function beginSync(): Promise<void> {
    const settings = get().settings;
    if (!settings.syncEnabled || !syncConfigured(settings)) return;
    try {
      const account = await currentAccount(settings);
      set({ account });
      if (!account) return;
      startSync(syncPorts());
    } catch (err) {
      set({
        syncStatus: {
          ...get().syncStatus,
          state: "error",
          error: err instanceof Error ? err.message : "Cloud sync failed to start.",
        },
      });
    }
  }

  const portrait = (memberId: string, force: boolean) => {
    const base = get().game.characters.find((c) => c.id === memberId);
    if (!base) return;
    // Image generation off (Images): ⟳ has nothing to do, and the
    // automatic pass degrades to a cache probe — a portrait drawn before the
    // switch was flipped still shows, it just never draws a new one.
    const allowed = imagesAllowed(get().settings);
    if (force && !allowed) return;
    // A removed portrait stays removed: the automatic trigger is "no cached
    // image → draw one", so without this the next turn would silently undo the
    // player's removal. Only ⟳ (force) or an upload overrides it.
    if (!force && base.noPortrait) return;
    if (force && base.noPortrait) {
      commitCharacters(
        get().game.characters.map((c) => (c.id === memberId ? { ...c, noPortrait: false } : c)),
      );
    }
    // Portraits are drawn from what the character looks like IN THIS ADVENTURE,
    // so a story-rewritten appearance regenerates correctly. The cache key stays
    // the bare character id — one portrait per character, shared everywhere.
    const member = resolve(base, getEntry(get().game.roster, memberId));
    void ensureImage(
      portraitKey(member.id),
      () => {
        const s = get().settings;
        // Style references ride along when set; the matching instruction line
        // is appended only then — zero references is a fully supported state.
        const refs = s.portraitRefImages.map(refImageToDataUrl);
        return {
          prompt: buildPortraitPrompt(member, activeTemplate(s), refs.length > 0),
          images: refs.length ? refs : undefined,
          aspectRatio: "2:3",
        };
      },
      force,
      { cacheOnly: !allowed },
    );
  };

  return {
  settings: loadSettings(),
  game: newGame(),
  hydrated: false,

  streaming: false,
  streamText: "",
  options: [],
  error: null,
  failedInput: null,
  dice: null,

  screen: null,
  history: [],
  memberId: null,
  section: null,
  backHandler: null,

  images: {},
  imgPending: {},
  imgError: {},

  slots: [],

  account: null,
  syncStatus: { state: "idle", lastSyncedAt: 0, error: null },
  authPending: false,
  authError: null,
  authNotice: null,

  autoUpdating: false,
  autoUpdateError: null,

  fieldGenPending: false,
  journalPending: false,
  fieldGenError: null,

  foresightPending: false,
  foresightError: null,

  async hydrate() {
    // Before anything reads a picture: fold the retired `src:` masters onto the
    // keys they belong to, so a device upgrading from a build with the 1-bit
    // downscale shows the good pixels rather than the thumbnails they were
    // crushed to. Awaited — `syncImages` below publishes what it finds, and a
    // promotion landing after that would sit behind an object URL of the copy
    // it replaced.
    try {
      await promoteLegacyMasters();
    } catch {
      // A migration that could not run leaves the old art in place; it is
      // retried on the next launch and must never block one.
    }

    const loaded = await loadActiveGame();
    if (loaded) {
      // The one-time fold: a game stored while the cast was global has none of
      // its own, so it takes the old library wholesale. Anything that library
      // no longer has — a pre-split save still carrying its own people — is
      // folded in behind it, so no authored character is lost on the way over.
      const loadedGame = loaded.legacyCast
        ? {
            ...loaded.game,
            characters: withPC(
              mergeLibrary((await loadLegacyCharacters()) ?? [], loaded.game.characters),
            ),
          }
        : { ...loaded.game, characters: withPC(loaded.game.characters) };

      // Foresight, sanitized at READ like every other stored shape, then given
      // the scenario's arc if the game has none — which is every save written
      // before the feature, and every scenario that gains an arc later. Returns
      // the same references when there is nothing to do.
      const normalized = normalizeForesight(loadedGame);
      const arcs = seedArcs(normalized, normalized.turnNumber);
      const game = arcs === normalized.arcs ? normalized : { ...normalized, arcs };

      // Restore trailing options from the last narrator turn. Normalized on the
      // way out, like every other stored shape in the app: a block recorded
      // before the parser checked `options` can hold objects, and an object
      // reaching an option button is a React child that throws.
      const lastNarrator = [...game.messages].reverse().find((m) => m.role === "narrator");
      set({
        game,
        options: normalizeOptions(lastNarrator?.appliedDeltas?.options),
        hydrated: true,
      });
      void saveActiveGame(game);
    } else {
      // No stored game at all — but a device upgrading from a build that had
      // never autosaved could still hold a library, so it is worth asking.
      const stored = await loadLegacyCharacters();
      const game = stored?.length
        ? { ...get().game, characters: withPC(stored) }
        : get().game;
      set({ game, hydrated: true });
      void saveActiveGame(game);
    }
    get().syncImages();
    // Added fonts live as blobs in IndexedDB, so their stylesheet has to be
    // rebuilt every launch — nothing else mounts them.
    void mountWebFonts(get().settings.webFonts);
    // Cloud sync, if the player has signed in on this device. Deliberately
    // last and deliberately not awaited: the game is playable before the
    // network is, and a slow (or absent) connection must never delay hydrate.
    void beginSync();
  },

  setScreen(screen, section) {
    // Authoring edits made mid-stream get silently reverted by a later Undo
    // (the reversal is captured against the pre-turn snapshot), so block opening
    // any overlay while a turn streams — only closing (null) is allowed.
    if (screen !== null && get().streaming) return;
    const cur = get().screen;
    // Already here: a plain re-tap is a no-op, but a deep link still has work to
    // do — jumping between two sub-menus of one screen is exactly what the
    // cross-references between Images' own sections do.
    if (screen === cur) {
      if (section !== undefined) set({ section });
      return;
    }
    // Record where we came from so Back returns there, not a fixed parent.
    set({ screen, section: section ?? null, history: [...get().history, cur] });
  },

  goBack() {
    // A screen with its own internal depth (the sub-menu screens) gets first
    // refusal. Routing it through here rather than through the header's `onBack`
    // prop is what makes the ANDROID back button behave like the on-screen one —
    // the hardware button has no way to know about a component's local state.
    if (get().backHandler?.()) return;
    const hist = get().history;
    const prev = hist.length ? hist[hist.length - 1] : null;
    set({ screen: prev, history: hist.slice(0, -1), section: null });
  },

  clearSection() {
    if (get().section !== null) set({ section: null });
  },

  setBackHandler(handler) {
    set({ backHandler: handler });
  },

  openMember(id) {
    if (get().streaming) return;
    set({ screen: "member", memberId: id, history: [...get().history, get().screen] });
  },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings);
    set({ settings });
  },

  fontPending: false,
  fontError: null,

  async addWebFont(name) {
    if (get().fontPending) return;
    set({ fontPending: true, fontError: null });
    try {
      const font = await downloadWebFont(name);
      // Replace by id rather than appending: adding the same family twice is a
      // re-download, not a second row.
      const rest = get().settings.webFonts.filter((f) => f.id !== font.id);
      const webFonts = [...rest, font];
      // Selecting it is the point of adding it — nobody types a font name to
      // leave it unused, and the alternative is a two-tap Add-then-pick.
      get().updateSettings({ webFonts, font: font.id });
      await mountWebFonts(webFonts);
      set({ fontPending: false });
    } catch (e) {
      set({
        fontPending: false,
        fontError: e instanceof Error ? e.message : "Could not add that font.",
      });
    }
  },

  async removeWebFont(id) {
    const webFonts = get().settings.webFonts.filter((f) => f.id !== id);
    // The active font going away would leave `data-font` pointing at a rule
    // that no longer exists, so the selection comes back to the platform stack
    // in the same update rather than a frame later.
    const patch: Partial<Settings> =
      get().settings.font === id ? { webFonts, font: "system" } : { webFonts };
    get().updateSettings(patch);
    await unmountWebFont(id, webFonts);
  },

  updateScenario(patch) {
    const g = get().game;
    const scenario = { ...g.scenario, ...patch };
    // Editing the starting room/region/day retargets the active scene too, so
    // the scene mark follows immediately (it otherwise only moves per turn).
    const location = patch.startRoom !== undefined ? patch.startRoom : g.location;
    const day = patch.startDay !== undefined ? patch.startDay : g.day;
    // …and the region with it: `areaKey` is what Foresight → Region prepares
    // and what the map draws, so leaving it pointed at the old region would
    // make an edited Starting Region visible everywhere except where it is
    // spent. Existing cards are kept; only a region nothing has prepped yet
    // gets a stub.
    const retarget =
      patch.startRegion !== undefined || patch.startRoom !== undefined
        ? seedStartingArea(g.areas, scenario.startRegion, location)
        : { areaKey: g.areaKey ?? null, areas: g.areas };
    const game = {
      ...g,
      scenario,
      location,
      day,
      ...(retarget.areaKey ? { areaKey: retarget.areaKey } : {}),
      ...(retarget.areas ? { areas: retarget.areas } : {}),
    };
    set({ game });
    void saveActiveGame(game);
  },

  updateCharacter(id, patch) {
    // A name edit is a RENAME, not a field write: the old name goes to
    // `aliases` so every name-keyed matcher — speaker detection, NPC gating,
    // Auto-Update's story scan, the narrator's own party ops — keeps resolving
    // a transcript that still says it. `withRename` is the same helper the
    // narrator's "newName" op goes through, so both mean one thing. An edit
    // that also types the alias list wins: the player is being explicit.
    const characters = get().game.characters.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, ...patch };
      // The patch is applied first and the OLD name put back, so `withRename`
      // folds it onto whatever alias list the edit itself carries — a sheet
      // save always sends both fields. An unchanged name renames nobody.
      return patch.name === undefined ? next : withRename({ ...next, name: c.name }, patch.name);
    });
    commitCharacters(characters);

    // A player edit is the authored truth, so it also retires the story's
    // override on those same fields — otherwise the override would mask what
    // they just typed. Fields the story changed but the player didn't touch
    // stay overridden.
    const touched = Object.keys(patch).filter((k) =>
      OVERRIDABLE.includes(k as keyof CharacterOverride),
    ) as (keyof CharacterOverride)[];
    if (!touched.length) return;
    const g = get().game;
    const roster = clearRosterOverrides(g.roster, id, touched);
    if (roster === g.roster) return;
    const game = { ...g, roster };
    set({ game });
    void saveActiveGame(game);
  },

  addCharacter() {
    const character = newCharacter(uid());
    // Lands in the library only — the player adds them to the party from there.
    commitCharacters([...get().game.characters, character]);
    return character.id;
  },

  async autoUpdateCharacter(id, fields) {
    const selected = normalizeFields(fields);
    // A turn in flight owns the roster (its reversal snapshot is already
    // captured), so a sheet rewrite mid-stream would be silently undone.
    if (!selected.length || get().autoUpdating || get().streaming) return false;
    const base = get().game.characters.find((c) => c.id === id);
    if (!base) return false;
    const character = resolve(base, getEntry(get().game.roster, id));

    set({ autoUpdating: true, autoUpdateError: null });
    try {
      const raw = await completeChat({
        settings: get().settings,
        messages: buildAutoUpdateMessages({ game: get().game, character, fields: selected }),
        temperature: AUTO_UPDATE_TEMPERATURE,
      });
      const patch = parseAutoUpdate(raw, selected);
      if (!Object.keys(patch).length) {
        throw new Error("The model returned no usable fields. Try again.");
      }
      // The character can be deleted while the call is in flight.
      if (!get().game.characters.some((c) => c.id === id)) {
        set({ autoUpdating: false });
        return false;
      }
      // Auto-Update re-reads the character off THIS adventure's beats, so its
      // rewrite is a story change: it overrides for this run and leaves the
      // authored character intact.
      const g = get().game;
      const game = { ...g, roster: mergeOverrides(g.roster, id, patch) };
      set({ game, autoUpdating: false });
      void saveActiveGame(game);
      return true;
    } catch (err) {
      const message =
        err instanceof OpenRouterError || err instanceof Error
          ? err.message
          : "Auto-update failed.";
      set({ autoUpdating: false, autoUpdateError: message });
      return false;
    }
  },

  clearAutoUpdateError() {
    set({ autoUpdateError: null });
  },

  async writeJournalEntry(id, replace = false) {
    if (get().journalPending || !get().settings.journalEnabled) return;
    const game = get().game;
    const entry = game.journal.find((e) => e.id === id);
    if (!entry) return;

    // A rewrite drops the previous written lines first, so ⟳ replaces them
    // instead of stacking a second summary on top of the first. The facts are
    // the client's and are never thrown away.
    const base = replace ? entry.lines.filter((l) => l.source === "system") : entry.lines;

    set({ journalPending: true });
    try {
      const raw = await completeChat({
        settings: get().settings,
        messages: buildJournalMessages(get().settings, game, { ...entry, lines: base }),
        temperature: JOURNAL_TEMPERATURE,
      });
      const lines = parseJournalLines(raw);

      // Re-read the store: the player may have undone the turn that opened this
      // entry while the call was in flight, and a late write must never
      // resurrect it. `appendModelLines` returns the same array on a missing id.
      const current = get().game;
      const cleared = replace
        ? current.journal.map((e) =>
            e.id === id ? { ...e, lines: e.lines.filter((l) => l.source === "system") } : e,
          )
        : current.journal;
      const journal = appendModelLines(cleared, id, lines);
      if (journal === current.journal) return;
      const next = { ...current, journal };
      set({ game: next });
      void saveActiveGame(next);
    } catch {
      // Deliberately silent. The entry keeps its facts, the Journal screen
      // offers a retry, and a summary that failed is not a turn that failed.
    } finally {
      set({ journalPending: false });
    }
  },

  updateJournalEntry(id, lines) {
    const g = get().game;
    if (!g.journal.some((e) => e.id === id)) return;
    const next = {
      ...g,
      journal: g.journal.map((e) => (e.id === id ? { ...e, lines } : e)),
    };
    set({ game: next });
    void saveActiveGame(next);
  },

  deleteJournalEntry(id) {
    const g = get().game;
    if (!g.journal.some((e) => e.id === id)) return;
    const next = { ...g, journal: g.journal.filter((e) => e.id !== id) };
    set({ game: next });
    void saveActiveGame(next);
  },

  /* ------------------------- Foresight ------------------------- */

  prepForesight() {
    void runPrep();
  },

  async generateAreaCard(hint) {
    // Single-flight against the other ✦ flows, and nothing else: this writes no
    // state, so a turn or an automatic prep in flight has nothing to undo.
    if (get().fieldGenPending) return null;
    const game = get().game;
    const key = game.areaKey;
    if (!key) return null;

    set({ fieldGenPending: true, fieldGenError: null });
    try {
      const settings = get().settings;
      const name = (game.areas ?? {})[key]?.name || game.location;
      const raw = await completeChat({
        settings,
        messages: buildAreaMessages(
          settings,
          game,
          name,
          runningArc(game.arcs),
          game.promises ?? [],
          hint,
        ),
        temperature: AREA_PREP_TEMPERATURE,
      });
      const parsed = parseAreaCard(raw);
      if (!parsed) throw new Error("The model returned nothing usable. Try again.");
      set({ fieldGenPending: false });
      return parsed;
    } catch (err) {
      const message =
        err instanceof OpenRouterError || err instanceof Error
          ? err.message
          : "Generation failed.";
      set({ fieldGenPending: false, fieldGenError: message });
      return null;
    }
  },

  applyAreaCard(parsed) {
    const key = get().game.areaKey;
    if (!key) return;
    commitAreaCard(key, parsed);
  },

  async generateRoomCard(hint) {
    if (get().fieldGenPending) return null;
    const game = get().game;
    const areaKey = game.areaKey;
    const area = areaKey ? (game.areas ?? {})[areaKey] : undefined;
    // A room is prepped INSIDE a region, so there is nothing to write against
    // until one exists — the same guard `prepRoom` makes.
    if (!area) return null;

    set({ fieldGenPending: true, fieldGenError: null });
    try {
      const settings = get().settings;
      const name = area.rooms[roomKey(game.location)]?.name || game.location;
      const raw = await completeChat({
        settings,
        messages: buildRoomMessages(
          settings,
          game,
          name,
          area,
          activeMembers(game.characters, game.roster),
          game.promises ?? [],
          hint,
        ),
        temperature: ROOM_PREP_TEMPERATURE,
      });
      const parsed = parseRoomCard(raw);
      if (!parsed) throw new Error("The model returned nothing usable. Try again.");
      set({ fieldGenPending: false });
      return parsed;
    } catch (err) {
      const message =
        err instanceof OpenRouterError || err instanceof Error
          ? err.message
          : "Generation failed.";
      set({ fieldGenPending: false, fieldGenError: message });
      return null;
    }
  },

  applyRoomCard(parsed) {
    const game = get().game;
    const areaKey = game.areaKey;
    if (!areaKey) return;
    const name = (game.areas ?? {})[areaKey]?.rooms[roomKey(game.location)]?.name;
    commitRoomCard(areaKey, name || game.location, parsed);
  },

  updateArea(patch) {
    const game = get().game;
    const key = game.areaKey;
    if (!key) return;
    const card = (game.areas ?? {})[key];
    if (!card) return;
    // Written RAW, sanitized at read (`foresight.ts → normalizeCards`). Capping
    // a line here would trim it out from under the cursor mid-word.
    commitForesight({ areas: { ...(game.areas ?? {}), [key]: { ...card, ...patch } } });
  },

  updateRoom(patch) {
    const game = get().game;
    const areaKey = game.areaKey;
    if (!areaKey) return;
    const area = (game.areas ?? {})[areaKey];
    if (!area) return;

    const key = roomKey(game.location);
    if (!key) return;
    // The room may be one the map has never heard of — the player is typing a
    // card for the place they are standing in, which is reason enough to add it.
    const next = addRoom(area, game.location);
    const slot = next.rooms[key];
    if (!slot) return;

    const card: RoomCard = slot.card ?? {
      version: next.version,
      openedTurn: game.turnNumber,
      danger: "",
      threats: [],
      hooks: [],
      outcomes: { strong: "", mixed: "", cost: "" },
    };
    commitForesight({
      areas: {
        ...(game.areas ?? {}),
        [areaKey]: {
          ...next,
          rooms: { ...next.rooms, [key]: { ...slot, card: { ...card, ...patch } } },
        },
      },
    });
  },

  async stageNextArc(force = false) {
    const settings = get().settings;
    if (!settings.foresightEnabled || get().foresightPending) return;
    const game = get().game;
    const arc = runningArc(game.arcs);
    // With NO arc running there is nothing to stage against — the scenario
    // never authored one, or the player deleted theirs — so the same call opens
    // one directly. Without this the arc scope is unreachable: an interlude is
    // the only other thing that writes an arc, and an interlude can only begin
    // when an arc's front fires.
    if (!arc) {
      set({ foresightPending: true, foresightError: null });
      try {
        const raw = await completeChat({
          settings,
          messages: buildArcMessages(settings, game, game.characters, undefined),
          temperature: ARC_TEMPERATURE,
        });
        const template = parseArc(raw);
        if (!template) throw new Error("The arc came back empty.");
        const now = get().game;
        commitForesight({
          arcs: handOff(now.arcs ?? [], template, `arc-${(now.arcs ?? []).length + 1}`, now.turnNumber, now.day),
        });
      } catch (err) {
        set({
          foresightError: err instanceof Error ? err.message : "Could not write the arc.",
        });
      } finally {
        set({ foresightPending: false });
      }
      return;
    }
    // A staged arc is never quietly replaced; `force` is the player pressing ✦.
    if (arc.staged && !force) return;
    // The one automatic caller is the interlude (`runPrep`), which never forces.
    // A RUNNING arc only ever reaches here behind the screen's button, and what
    // it writes REPLACES the chapter in hand rather than opening the next one —
    // so the model is told that, and `applyStagedArc` does it.
    const rewrite = arc.status !== "interlude";
    if (rewrite && !force) return;

    set({ foresightPending: true, foresightError: null });
    try {
      const raw = await completeChat({
        settings,
        messages: buildArcMessages(
          settings,
          game,
          game.characters,
          arc,
          rewrite ? "rewrite" : "next",
        ),
        temperature: ARC_TEMPERATURE,
      });
      const staged = parseArc(raw);
      if (!staged) throw new Error("The arc came back empty.");
      // STAGED, not applied. This call writes the next several hours of play off
      // a summary and the player will want to co-author it, so it is previewed
      // on the Arc screen and applied only by Use — or by the interlude running
      // out (`foresight.ts → closeInterlude`), because an offer to co-author must
      // never dead-end the campaign into arcless play.
      const now = get().game;
      commitForesight({
        arcs: (now.arcs ?? []).map((a) => (a.id === arc.id ? { ...a, staged } : a)),
      });
    } catch (err) {
      set({
        foresightError: err instanceof Error ? err.message : "Could not write the next arc.",
      });
    } finally {
      set({ foresightPending: false });
    }
  },

  applyStagedArc() {
    const game = get().game;
    const arc = runningArc(game.arcs);
    if (!arc?.staged) return;

    // Two meanings for one button, decided by where the arc stands. An
    // interlude means the chapter is OVER, so the staged one opens beside it
    // and both are campaign history. A running arc means the player did not
    // want the chapter they are in, so there is no history to keep: it is
    // rewritten in its seat.
    if (arc.status === "interlude") {
      commitForesight({
        arcs: handOff(
          game.arcs ?? [],
          arc.staged,
          `arc-${game.turnNumber}-${(game.arcs ?? []).length + 1}`,
          game.turnNumber,
          game.day,
        ),
      });
      return;
    }
    const staged = arc.staged;
    commitForesight({
      arcs: (game.arcs ?? []).map((a) => (a.id === arc.id ? rewriteArc(a, staged, game.day) : a)),
    });
  },

  discardStagedArc() {
    const game = get().game;
    const arc = runningArc(game.arcs);
    if (!arc?.staged) return;
    commitForesight({
      arcs: (game.arcs ?? []).map((a) => (a.id === arc.id ? { ...a, staged: undefined } : a)),
    });
  },

  endInterlude() {
    const game = get().game;
    const arc = runningArc(game.arcs);
    if (!arc || arc.status !== "interlude") return;
    commitForesight({
      arcs: closeInterlude(game.arcs ?? [], arc, game.turnNumber, game.day),
    });
  },

  updateArc(patch) {
    const game = get().game;
    const arc = runningArc(game.arcs);
    if (!arc) return;
    commitForesight({
      arcs: (game.arcs ?? []).map((a) => (a.id === arc.id ? { ...a, ...patch } : a)),
    });
  },

  closePromise(id) {
    const game = get().game;
    const promises = (game.promises ?? []).filter((p) => p.id !== id);
    if (promises.length === (game.promises ?? []).length) return;
    commitForesight({ promises });
  },

  clearForesightError() {
    if (get().foresightError) set({ foresightError: null });
  },

  async generateField(character, field, hint) {
    // Single-flight only. Unlike `autoUpdateCharacter` there is no `streaming`
    // guard and no "was it deleted?" re-check after the await: this writes no
    // game state, so there is nothing a turn in flight could silently undo, and
    // the text is handed back to a modal rather than to the store.
    if (get().fieldGenPending) return null;

    set({ fieldGenPending: true, fieldGenError: null });
    try {
      const raw = await completeChat({
        settings: get().settings,
        messages: buildFieldMessages({
          game: get().game,
          settings: get().settings,
          character,
          field,
          hint,
        }),
        temperature: GENERATE_FIELD_TEMPERATURE,
      });
      const text = parseGeneratedField(raw, field);
      if (!text) throw new Error("The model returned nothing usable. Try again.");
      set({ fieldGenPending: false });
      return text;
    } catch (err) {
      const message =
        err instanceof OpenRouterError || err instanceof Error
          ? err.message
          : "Generation failed.";
      set({ fieldGenPending: false, fieldGenError: message });
      return null;
    }
  },

  async generateScenarioField(field, hint) {
    // Single-flight, and nothing else: like `generateField` this writes no game
    // state, so there is nothing a turn in flight could silently undo.
    if (get().fieldGenPending) return null;

    set({ fieldGenPending: true, fieldGenError: null });
    try {
      const raw = await completeChat({
        settings: get().settings,
        messages: buildScenarioMessages({
          game: get().game,
          characters: get().game.characters,
          field,
          hint,
        }),
        temperature: GENERATE_SCENARIO_TEMPERATURE,
      });
      // Same one-key JSON contract as a character field, same tolerant parser.
      const text = parseGeneratedField(raw, field);
      if (!text) throw new Error("The model returned nothing usable. Try again.");
      set({ fieldGenPending: false });
      return text;
    } catch (err) {
      const message =
        err instanceof OpenRouterError || err instanceof Error
          ? err.message
          : "Generation failed.";
      set({ fieldGenPending: false, fieldGenError: message });
      return null;
    }
  },

  async generateItem(hint, existing, character) {
    // Single-flight, and nothing else — same reasoning as `generateField`: this
    // writes no game state, and the row is handed back to a modal.
    if (get().fieldGenPending) return null;

    set({ fieldGenPending: true, fieldGenError: null });
    try {
      const raw = await completeChat({
        settings: get().settings,
        messages: buildItemMessages({
          game: get().game,
          existing,
          character,
          hint,
        }),
        temperature: GENERATE_ITEM_TEMPERATURE,
      });
      // Three keys rather than one, so it has a parser of its own — a label is
      // the part that can't be missing.
      const item = parseGeneratedItem(raw);
      if (!item) throw new Error("The model returned nothing usable. Try again.");
      set({ fieldGenPending: false });
      return item;
    } catch (err) {
      const message =
        err instanceof OpenRouterError || err instanceof Error
          ? err.message
          : "Generation failed.";
      set({ fieldGenPending: false, fieldGenError: message });
      return null;
    }
  },

  clearFieldGenError() {
    set({ fieldGenError: null });
  },

  removeCharacter(id) {
    // The PC is never deletable — only other characters.
    const target = get().game.characters.find((c) => c.id === id);
    if (!target || target.role === "pc") return;
    commitCharacters(get().game.characters.filter((c) => c.id !== id));

    // Forget them in the active adventure too. Save slots may still name them;
    // `partyMembers` skips ids the library no longer has, so those degrade to a
    // smaller party rather than breaking.
    const g = get().game;
    const game = { ...g, roster: dropEntry(g.roster, id) };

    // Free the character's portrait blob and object URL — nothing references
    // them once they're gone, so they would otherwise orphan in IndexedDB.
    const key = portraitKey(id);
    void deleteImage(key);
    const prevUrl = get().images[key];
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    const images = { ...get().images };
    delete images[key];
    set({
      game,
      images,
      screen: get().screen === "member" ? "characters" : get().screen,
    });
    void saveActiveGame(game);
  },

  setStanding(id, standing) {
    const g = get().game;
    const target = get().game.characters.find((c) => c.id === id);
    if (!target || target.role !== "member") return;
    // Only the scene is capped. Everything else — bench, NPC, kick, departed —
    // is always allowed, and a standing change is never coupled to another:
    // kicking someone out of the party is not the story writing them off.
    if (
      standing === "active" &&
      standingOf(g.roster, id) !== "active" &&
      partyFull(get().game.characters, g.roster)
    )
      return;
    const roster = setEntryStanding(g.roster, id, standing);
    if (roster === g.roster) return;
    const game = { ...g, roster };
    set({ game });
    void saveActiveGame(game);
    // Anyone the player can now see in the strip or the Party screen needs a
    // portrait.
    if (isInParty(standing)) get().syncImages();
  },

  setCondition(id, condition) {
    const g = get().game;
    // No role check: a condition is the one piece of character state that
    // applies to the PC as much as to a companion.
    const roster = setEntryCondition(g.roster, id, condition);
    if (roster === g.roster) return;
    const game = { ...g, roster };
    set({ game });
    void saveActiveGame(game);
  },

  revertOverrides(id) {
    const g = get().game;
    const roster = clearRosterOverrides(g.roster, id);
    if (roster === g.roster) return;
    const game = { ...g, roster };
    set({ game });
    void saveActiveGame(game);
  },

  addNote() {
    const g = get().game;
    const note: Note = { id: uid(), title: "", keywords: [], content: "", permanent: false };
    const game = { ...g, worldNotes: [...g.worldNotes, note] };
    set({ game });
    void saveActiveGame(game);
  },

  updateNote(id, patch) {
    const g = get().game;
    const worldNotes = g.worldNotes.map((n) => (n.id === id ? { ...n, ...patch } : n));
    const game = { ...g, worldNotes };
    set({ game });
    void saveActiveGame(game);
  },

  removeNote(id) {
    const g = get().game;
    const game = { ...g, worldNotes: g.worldNotes.filter((n) => n.id !== id) };
    set({ game });
    void saveActiveGame(game);
  },

  addQuest() {
    const g = get().game;
    const quest: Quest = { id: uid(), label: "", description: "", reward: "", status: "active" };
    const game = { ...g, quests: [...g.quests, quest] };
    set({ game });
    void saveActiveGame(game);
  },

  updateQuest(id, patch) {
    const g = get().game;
    const quests = g.quests.map((q) => (q.id === id ? { ...q, ...patch } : q));
    const game = { ...g, quests };
    set({ game });
    void saveActiveGame(game);
  },

  removeQuest(id) {
    const g = get().game;
    const game = { ...g, quests: g.quests.filter((q) => q.id !== id) };
    set({ game });
    void saveActiveGame(game);
  },

  addItem() {
    const g = get().game;
    const item: Item = { label: "", description: "", quantity: 1 };
    const game = { ...g, inventory: [...g.inventory, item] };
    set({ game });
    void saveActiveGame(game);
  },

  updateItem(index, patch) {
    const g = get().game;
    if (index < 0 || index >= g.inventory.length) return;
    const inventory = g.inventory.map((it, i) => (i === index ? { ...it, ...patch } : it));
    const game = { ...g, inventory };
    set({ game });
    void saveActiveGame(game);
  },

  removeItem(index) {
    const g = get().game;
    if (index < 0 || index >= g.inventory.length) return;
    const inventory = g.inventory.filter((_, i) => i !== index);
    const game = { ...g, inventory };
    set({ game });
    void saveActiveGame(game);
  },

  // Bulk setters — commit a whole edited draft in one shot (edit-mode Save).
  setQuests(quests) {
    const g = get().game;
    const game = { ...g, quests };
    set({ game });
    void saveActiveGame(game);
  },

  setInventory(inventory) {
    const g = get().game;
    // Gold is permanent — an edit-mode draft can't delete the currency row.
    const game = { ...g, inventory: ensureGold(inventory) };
    set({ game });
    void saveActiveGame(game);
  },

  equipItem(index, characterId) {
    moveGear(characterId, (inventory, equipment) => moveToKit(inventory, equipment, index));
  },

  unequipItem(characterId, index) {
    moveGear(characterId, (inventory, equipment) => moveToPack(inventory, equipment, index));
  },

  newAdventure(imports) {
    // What survives is the player's call now that the cast belongs to the
    // adventure — `seedAdventure` holds every rule; this just writes the result.
    const seeded = seedAdventure(get().game, imports);
    // The scenario's authored arc opens with the adventure, so a shipped
    // scenario starts with a real one and no new import tick is needed: the arc
    // rides the scenario's own tick, being part of it.
    const arcs = seedArcs(seeded, 0);
    const game = arcs === seeded.arcs ? seeded : { ...seeded, arcs };
    set({ game, options: [], streamText: "", error: null, failedInput: null });
    void saveActiveGame(game);
    get().syncImages();
  },

  async signIn(email, password) {
    if (get().authPending) return;
    set({ authPending: true, authError: null, authNotice: null });
    try {
      const account = await authSignIn(get().settings, email.trim(), password);
      // Signing in IS switching sync on: nobody types an email and a password
      // into a screen called Cloud Saves to leave it off.
      get().updateSettings({ syncEnabled: true });
      set({ account });
      startSync(syncPorts());
    } catch (err) {
      set({ authError: err instanceof Error ? err.message : "Sign in failed." });
    } finally {
      set({ authPending: false });
    }
  },

  async signUp(email, password) {
    if (get().authPending) return;
    set({ authPending: true, authError: null, authNotice: null });
    try {
      const { account, needsConfirmation } = await authSignUp(
        get().settings,
        email.trim(),
        password,
      );
      if (needsConfirmation) {
        // Email confirmation is on for this project. Saying so is the whole
        // point — the screen otherwise looks like the button did nothing.
        set({ authNotice: "Account created. Confirm the email, then sign in." });
        return;
      }
      get().updateSettings({ syncEnabled: true });
      set({ account });
      startSync(syncPorts());
    } catch (err) {
      set({ authError: err instanceof Error ? err.message : "Sign up failed." });
    } finally {
      set({ authPending: false });
    }
  },

  async signOut() {
    stopSync();
    try {
      await authSignOut(get().settings);
    } finally {
      set({
        account: null,
              syncStatus: { state: "idle", lastSyncedAt: 0, error: null },
      });
    }
  },

  async syncNow() {
    if (!get().account) return;
    await runSync();
  },

  setSyncEnabled(on) {
    get().updateSettings({ syncEnabled: on });
    if (!on) {
      stopSync();
      set({ syncStatus: { state: "idle", lastSyncedAt: 0, error: null } });
      return;
    }
    void beginSync();
  },

  clearAuthError() {
    set({ authError: null, authNotice: null });
  },

  async refreshSlots() {
    set({ slots: await listSlots() });
  },

  async snapshotSlot(name) {
    const slot: SaveSlot = {
      id: uid(),
      name: name.trim() || `Save ${new Date().toLocaleString()}`,
      savedAt: Date.now(),
      // Deep-clone so later edits to the active game don't mutate the snapshot.
      game: structuredClone(get().game),
    };
    await saveSlot(slot);
    // The art is a snapshot too. Blobs live outside the document, keyed by
    // character, so without this copy a regenerate or an upload would rewrite
    // the faces of every save that character ever appeared in.
    await freezeSlotArt(slot.id, slot.game);
    await get().refreshSlots();
  },

  async overwriteSlot(id) {
    // Same id, same name, new bytes: `saveSlot` writes by id, so this replaces
    // the stored snapshot in place (and re-stamps it for sync) rather than
    // leaving the player a list of near-identical saves. Read the name back
    // from the store instead of the in-memory list, so a rename on another
    // device isn't clobbered by a stale row. A slot deleted meanwhile is not
    // resurrected — no slot, no overwrite.
    const existing = await readSlot(id);
    if (!existing) {
      await get().refreshSlots();
      return;
    }
    const game = structuredClone(get().game);
    await saveSlot({ id, name: existing.name, savedAt: Date.now(), game });
    // Swept first, then re-frozen: a character who has left the cast since the
    // last snapshot would otherwise leave their portrait in this slot forever,
    // and the slot only ever names the art it currently holds.
    await dropSlotArt(id);
    await freezeSlotArt(id, game);
    await get().refreshSlots();
  },

  async restoreSlot(id) {
    const loaded = await loadSlot(id);
    if (!loaded) return;
    // A slot restores a whole ADVENTURE — its cast and its player character
    // included, which is the point: a snapshot you restore should give you back
    // the people you saved it with, not whoever happens to be in the app now.
    // A slot taken while the cast lived outside the game carries none, so it
    // keeps the one in hand rather than restoring to nobody.
    const restored = loaded.legacyCast
      ? { ...loaded.game, characters: get().game.characters }
      : { ...loaded.game, characters: withPC(loaded.game.characters) };
    // A slot froze the whole adventure, Foresight included — but a slot written
    // by an older build has none, and one hand-edited in the cloud can hold
    // anything. Same read-time sanitizing as hydrate.
    const game = normalizeForesight(restored);
    const lastNarrator = [...game.messages].reverse().find((m) => m.role === "narrator");
    set({
      game,
      options: normalizeOptions(lastNarrator?.appliedDeltas?.options),
      streamText: "",
      error: null,
      failedInput: null,
      screen: null,
      history: [],
    });
    void saveActiveGame(game);
    // The people come back with the faces they had when the save was taken.
    // Ahead of `syncImages`, which fills in whatever the slot had no copy of.
    await thawSlotArt(id, game);
    get().syncImages();
  },

  async dropSlot(id) {
    await deleteSlot(id);
    // The frozen art goes with the save it belonged to — nothing else can reach
    // it, and each deletion is stamped, so the cloud copy goes too.
    await dropSlotArt(id);
    await get().refreshSlots();
  },

  async sendTurn(text, opts) {
    const trimmed = text.trim();
    if (!trimmed || get().streaming) return;

    const base = get().game;
    const turn = base.turnNumber + 1;

    const playerMsg: Message = {
      id: uid(),
      role: "player",
      content: trimmed,
      turn,
    };

    // Show the player's line immediately; clear stale options.
    set({
      game: { ...base, messages: [...base.messages, playerMsg], turnNumber: turn },
      options: [],
      error: null,
      failedInput: null,
      streaming: true,
      streamText: "",
    });

    turnAbort = new AbortController();

    // Roll this turn's stakes HERE rather than inside `buildMessages`: the band
    // is both a prompt block and a fact recorded on the narrator message, and
    // rolling it twice could disagree. Seeded on (turn, text), so a regenerate
    // re-tells the same result instead of re-rolling for a better one. The dice
    // themselves come from the player's system (Menu → RPG System).
    const stakes = computeStakes(
      trimmed,
      playerCharacter(get().game.characters, base.roster),
      turn,
      stakeRules(get().settings),
    );

    // The roll as it will be recorded on the beat — computed once, so the dice
    // thrown across the screen, the chip on the message, and the block the
    // narrator was handed are all the same numbers by construction.
    const record = get().settings.stakesEnabled ? rollRecord(stakes) : null;

    // Throw them NOW rather than when the turn lands: the result is already
    // decided, so the toss plays over the wait for the model's first token
    // instead of adding time to the turn. Presentational only — a game with the
    // animation off resolves identically.
    if (record && stakes.outcome && get().settings.diceAnimation) {
      set({ dice: { id: uid(), roll: record, outcome: stakes.outcome } });
    }

    // The note the narrator wrote for the button the player just pressed, read
    // off the beat that offered it. By INDEX: the note belongs to the option,
    // not to its wording, so a typed or edited action finds none — correctly.
    const lastBeat = [...base.messages].reverse().find((m) => m.role === "narrator");
    const optionNote =
      opts?.optionIndex === undefined
        ? undefined
        : lastBeat?.optionNotes?.[opts.optionIndex];

    // Build from `base` (pre-turn history) so the new line isn't duplicated —
    // it rides as the final user message, not also inside the history window.
    const messages = buildMessages({
      settings: get().settings,
      game: base,
      characters: get().game.characters,
      playerMessage: trimmed,
      stakes,
      historyBudgetTokens: get().settings.historyBudget,
      // Blank on every ordinary turn, which adds nothing to the prompt.
      regenerateNote: opts?.note,
      optionNote,
    });

    try {
      const raw = await streamChat({
        settings: get().settings,
        messages,
        signal: turnAbort.signal,
        onDelta: (full) => set({ streamText: truncateForDisplay(full) }),
      });

      const parsed = parseLoomResponse(raw);
      const prose = parsed.prose;
      let block = parsed.block;

      // The turn came back with nothing usable — no block at all, or a block
      // with no buttons in it. Ask once, over the beat the model already wrote.
      // Deliberately BEFORE anything is applied, so a repaired block runs
      // through `reconcileBlock` → `applyDeltas` → the reversal snapshot on the
      // one code path every other turn takes.
      //
      // The prose is already on screen, so this costs the buttons a moment, not
      // the beat. And it can only ever add: a failed or refused repair leaves
      // the turn exactly as it arrived rather than turning a beat the player can
      // read into an error they have to retry.
      if (needsBlockRepair(get().settings, block)) {
        try {
          const repairRaw = await completeChat({
            settings: get().settings,
            messages: buildRepairMessages(messages, raw, block !== null),
            signal: turnAbort.signal,
            temperature: BLOCK_REPAIR_TEMPERATURE,
          });
          block = mergeRepairBlock(block, parseLoomResponse(repairRaw).block);
        } catch {
          // Including an abort: the player pressing Stop during a repair wants
          // the turn over, not thrown away.
        }
      }

      const g = get().game;
      const library = get().game.characters;
      // Fold restated ops and no-ops out BEFORE applying — and record the folded
      // block, not the raw one, so the transcript's chips report what actually
      // happened. The prose rides along for the one check that reads it: a Gold
      // total that moves on a beat with no money in it.
      const applied = block ? reconcileBlock(g, library, block, prose) : null;
      // Applied even with NO block: an unreadable turn still has to move the
      // clock, or a parse failure freezes time. An empty block writes nothing
      // and returns the same slice references, so reversal still captures
      // nothing — it only advances the clock by the default duration.
      const scene = applyDeltas(g, library, applied ?? {});

      // Party deltas apply first, THEN deterministic speaker detection bumps
      // lastSpokeTurn — the model's `spoke` hint never overrides the prose
      // (loom-spotlight). Run against the post-delta ACTIVE roster: only the
      // members in the scene carry a spotlight debt worth tracking.
      const characters = scene.characters;
      let roster = scene.roster;
      const party = activeMembers(characters, roster);
      const spokeIds = new Set(detectSpeakers(prose, party));
      for (const id of spokeIds) roster = setEntry(roster, id, { lastSpokeTurn: turn });

      // A turn may have written new characters into the cast; it rides into
      // `nextGame` below with every other slice the turn touched, so there is
      // one write and one autosave for the whole turn.

      // Reckon: what the CLIENT does now the block has applied — the room→area
      // join, front ticks, neglect, promises. No call, and folded into the same
      // `nextGame` below, so it rides the same save and the same reversal
      // snapshot, exactly how a `condition` rides the roster. Skipped entirely
      // when the feature is off, which is what makes a turn taken with it off
      // byte-identical to one taken before it existed.
      const foresight = get().settings.foresightEnabled
        ? reckonTurn({
            game: { ...g, roster },
            settings: get().settings,
            turn,
            day: scene.day,
            location: scene.location,
            block: applied,
            outcome: get().settings.stakesEnabled ? stakes.outcome : null,
          })
        : null;

      // The beat itself, minus its reversal — the journal reads this turn's own
      // ops, so the message has to exist before the snapshot does.
      const beat: Message = {
        id: uid(),
        role: "narrator",
        content: prose || raw.trim(),
        turn,
        outcome:
          get().settings.stakesEnabled && stakes.outcome ? stakes.outcome : undefined,
        // The arithmetic beside the verdict — see `TurnRoll`. Same gate, so a
        // game with stakes off records neither.
        roll: record ?? undefined,
        appliedDeltas: applied ?? undefined,
        // What each of this beat's buttons risks, kept so the note comes back
        // if the player presses one. Never rendered.
        optionNotes: applied?.optionNotes,
        // What the CLIENT did, kept apart from `appliedDeltas` because that
        // array is a record of what the MODEL said — and `toasts.ts` reads both.
        reckoning: foresight?.reckoning,
        day: scene.day,
        minutes: scene.minutes,
        location: scene.location,
        weather: scene.weather,
      };
      const transcript = [...g.messages, beat];

      // The journal entry (if this turn closed one) is opened HERE, before the
      // reversal snapshot, carrying only its client-derived lines — no network.
      // Its written lines are fetched afterwards and appended in place.
      // Snapshotting before an async append would restore to a state the entry
      // was already in, and undo would leave it stranded.
      const journal = openJournalEntry({
        game: { ...g, messages: transcript },
        settings: get().settings,
        characters,
        turn,
        day: scene.day,
        rested: scene.rested,
      });

      // Reference-diff the pre-turn slices (base) against the post-turn ones so
      // undo/regenerate can restore exactly what this turn overwrote (Phase 5).
      const post = {
        ...base,
        roster,
        inventory: scene.inventory,
        quests: scene.quests,
        worldNotes: scene.worldNotes,
        journal,
        day: scene.day,
        minutes: scene.minutes,
        location: scene.location,
        weather: scene.weather,
        // Foresight's pointers and clocks. `areas` is deliberately absent — see
        // `captureReversal`: prep is a cache, not state.
        ...(foresight
          ? {
              arcs: foresight.arcs,
              promises: foresight.promises,
              areaKey: foresight.areaKey,
            }
          : {}),
      };
      const narratorMsg: Message = { ...beat, reversal: captureReversal(base, post) };

      const nextGame: GameState = {
        ...g,
        messages: [...g.messages, narratorMsg],
        characters,
        roster,
        journal,
        day: scene.day,
        minutes: scene.minutes,
        location: scene.location,
        weather: scene.weather,
        inventory: scene.inventory,
        quests: scene.quests,
        worldNotes: scene.worldNotes,
        ...(foresight
          ? {
              arcs: foresight.arcs,
              areas: foresight.areas,
              areaKey: foresight.areaKey,
              promises: foresight.promises,
            }
          : {}),
      };

      set({
        game: nextGame,
        options: block?.options ?? [],
        streaming: false,
        streamText: "",
      });
      void saveActiveGame(nextGame);

      // Deterministic trigger: new members get portraits. Fire-and-forget —
      // never blocks the turn.
      get().syncImages();

      // Same posture for the prep: the region, this room and its neighbours are
      // fetched AFTER the beat has landed, so the player is reading while they
      // arrive. A card that lands late simply makes the next turn better.
      get().prepForesight();

      // Same posture for the journal: the entry is already saved with its
      // facts, so fetching its written lines happens after the beat has landed
      // and can fail without the player ever seeing it.
      if (journal !== g.journal) {
        void get().writeJournalEntry(journal[journal.length - 1].id);
      }
    } catch (err) {
      const aborted =
        err instanceof DOMException
          ? err.name === "AbortError"
          : err instanceof Error && err.name === "AbortError";
      const message = aborted
        ? "Turn stopped."
        : err instanceof OpenRouterError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Turn failed.";

      // Roll the optimistic player line back out so a failed turn never eats
      // the input — it stays retryable via retryTurn instead of orphaned in
      // the log with no narrator reply.
      const g2 = get().game;
      const msgs = g2.messages.filter((m) => m.id !== playerMsg.id);
      const turnNumber = msgs.reduce((max, m) => Math.max(max, m.turn), 0);
      const lastNarrator = [...msgs].reverse().find((m) => m.role === "narrator");
      set({
        game: { ...g2, messages: msgs, turnNumber },
        options: normalizeOptions(lastNarrator?.appliedDeltas?.options),
        streaming: false,
        streamText: "",
        error: message,
        failedInput: trimmed,
      });
    } finally {
      turnAbort = null;
    }
  },

  retryTurn() {
    const text = get().failedInput;
    if (!text || get().streaming) return;
    void get().sendTurn(text);
  },

  stopTurn() {
    turnAbort?.abort();
  },

  clearDice(id) {
    if (get().dice?.id === id) set({ dice: null });
  },

  testRoll() {
    // A fresh seed per press — the one roll in the app that SHOULD come out
    // differently each time, since the point is to watch the system, not to
    // resolve anything. Nothing is recorded: no turn, no message, no history.
    const stakes = previewRoll(get().settings, `test|${Math.random()}`);
    const roll = rollRecord(stakes);
    if (!roll || !stakes.outcome) return;
    // Deliberately ignores `diceAnimation`: pressing Test Roll IS the request to
    // see it, and a button that did nothing while the toggle was off would read
    // as broken. It is also how the player decides whether to turn it on.
    set({ dice: { id: uid(), roll, outcome: stakes.outcome } });
  },

  undoLastTurn() {
    if (get().streaming) return;
    const g = get().game;
    // The latest completed turn is the last narrator message; a turn is one
    // player line + one narrator beat sharing a turn number.
    let idx = -1;
    for (let i = g.messages.length - 1; i >= 0; i--) {
      if (g.messages[i].role === "narrator") {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;

    const narrator = g.messages[idx];
    const restored = narrator.reversal ? applyReversal(g, narrator.reversal) : g;
    // The snapshot predates any character deleted since the turn ran, and undo
    // never touches the library — so drop entries nothing can resolve rather
    // than let them sit in the adventure holding party slots.
    const roster = pruneRoster(get().game.characters, restored.roster);

    // Drop both messages of that turn; restore options from the now-latest beat.
    const messages = g.messages.filter((m) => m.turn !== narrator.turn);
    const prevNarrator = [...messages].reverse().find((m) => m.role === "narrator");
    const turnNumber = messages.reduce((max, m) => Math.max(max, m.turn), 0);

    const game: GameState = { ...restored, roster, messages, turnNumber };
    set({
      game,
      options: normalizeOptions(prevNarrator?.appliedDeltas?.options),
      error: null,
      failedInput: null,
      streamText: "",
    });
    void saveActiveGame(game);
    get().syncImages();
  },

  regenerateLastTurn(note) {
    if (get().streaming) return;
    const g = get().game;
    let idx = -1;
    for (let i = g.messages.length - 1; i >= 0; i--) {
      if (g.messages[i].role === "narrator") {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;

    const turn = g.messages[idx].turn;
    const player = g.messages.find((m) => m.turn === turn && m.role === "player");
    // Unwind the turn, then replay the same player input for a fresh narration.
    // The note rides beside the input rather than inside it: the input is the
    // stakes seed, so folding the note in would re-roll the outcome and turn
    // "make it shorter" into a way to fish for a better result.
    get().undoLastTurn();
    if (player) void get().sendTurn(player.content, { note });
  },

  editMessage(id, content) {
    if (get().streaming) return;
    const g = get().game;
    const messages = g.messages.map((m) => (m.id === id ? { ...m, content } : m));
    const game = { ...g, messages };
    set({ game });
    void saveActiveGame(game);
  },

  editUserTurn(text) {
    const t = text.trim();
    if (!t || get().streaming) return;
    // Editing an input means the whole turn re-rolls: drop the latest turn
    // (player + narrator, restoring pre-turn scene) then re-send the new text.
    get().undoLastTurn();
    void get().sendTurn(t);
  },

  syncImages() {
    const g = get().game;
    // The PC rides the strip too, so its portrait must generate up front — not
    // only after the PC sheet is opened once. Benched members are covered as
    // well, since the Party screen shows them; everyone further out gets theirs
    // lazily, when their sheet opens.
    const chars = get().game.characters;
    for (const c of chars) if (c.role === "pc") portrait(c.id, false);
    for (const m of partyMembers(chars, g.roster)) portrait(m.id, false);
  },

  ensurePortrait(memberId) {
    portrait(memberId, false);
  },

  regeneratePortrait(memberId) {
    portrait(memberId, true);
  },

  async uploadPortrait(memberId, file) {
    const key = portraitKey(memberId);
    if (get().imgPending[key]) return;
    setImageError(key, null);
    set({ imgPending: { ...get().imgPending, [key]: true } });
    try {
      // The same bounding pass a generated portrait gets, so an upload is
      // stored exactly like every other picture — but strict, so an unreadable
      // file fails at the door instead of becoming a portrait that never loads.
      const blob = await toStoredImage(file, MAX_IMAGE_SIDE, true);
      await saveImage(key, blob);
      publishImage(key, blob);
      // Supplying art is the clearest possible "I want a picture here".
      if (get().game.characters.some((c) => c.id === memberId && c.noPortrait)) {
        commitCharacters(
          get().game.characters.map((c) => (c.id === memberId ? { ...c, noPortrait: false } : c)),
        );
      }
    } catch (err) {
      // An unreadable file just doesn't replace the portrait — flagged, with the
      // reason, so the sheet can say what went wrong instead of "image failed".
      setImageError(key, imageFailure(err));
    } finally {
      clearPending(key);
    }
  },

  removePortrait(memberId) {
    const key = portraitKey(memberId);
    if (get().imgPending[key]) return;
    void deleteImage(key);
    const prevUrl = get().images[key];
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    const images = { ...get().images };
    delete images[key];
    set({ images });
    setImageError(key, null);
    commitCharacters(
      get().game.characters.map((c) => (c.id === memberId ? { ...c, noPortrait: true } : c)),
    );
  },

  async purgeImages() {
    const stored = await listImageKeys();
    // Deleted through `db.deleteImage`, which stamps each key — that stamp is
    // what tells a device that syncs later this was a deletion and not a blob
    // it happens to be missing.
    for (const key of stored) await deleteImage(key);

    // The in-memory maps are swept separately rather than by the list above: a
    // key published in this session but already gone from IndexedDB would
    // otherwise keep a dead object URL alive in `images`.
    for (const url of Object.values(get().images)) URL.revokeObjectURL(url);
    set({ images: {}, imgError: {} });

    const summary: PurgeSummary = { local: stored.length, remote: 0, failed: 0, error: null };
    const account = get().account;
    if (!account || !get().settings.syncEnabled) return summary;
    try {
      const cloud = await purgeRemoteImages(get().settings, account);
      summary.remote = cloud.removed;
      summary.failed = cloud.failed;
    } catch (err) {
      summary.error = err instanceof Error && err.message ? err.message : "Could not reach the cloud.";
    }
    return summary;
  },

  async downloadPortrait(memberId) {
    const blob = await loadImage(portraitKey(memberId));
    if (!blob) return false;
    const name = get().game.characters.find((c) => c.id === memberId)?.name ?? "";
    try {
      // Straight out: the stored blob is the picture the model drew (or the
      // file the player uploaded), so there is nothing left to undo on the way
      // to the device.
      await saveBlobAsFile(blob, imageFileName(name));
      return true;
    } catch {
      return false;
    }
  },
  };
});
