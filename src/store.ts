import { create } from "zustand";
import type {
  AdventureImports,
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
import { runSync, startSync, stopSync, type SyncPorts, type SyncStatus } from "./lib/syncEngine";
import type { GameSummary } from "./lib/sync";
import { downloadWebFont, mountWebFonts, unmountWebFont } from "./lib/webFonts";
import {
  loadActiveGame,
  loadLegacyCharacters,
  saveActiveGame,
  loadImage,
  saveImage,
  deleteImage,
  saveSlot,
  loadSlot,
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
import { buildMessages } from "./lib/prompt";
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
import { parseLoomResponse, truncateForDisplay } from "./lib/loomBlock";
import { applyDeltas, reconcileBlock } from "./lib/deltas";
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
  BANNER_PIXEL_WIDTH,
  bannerAllowed,
  bannerKey,
  bannerOnCooldown,
  blobToDataUrl,
  imageEditAllowed,
  imagesAllowed,
  buildBannerPrompt,
  buildEditPrompt,
  buildPortraitPrompt,
  generateImage,
  isModelSafeImage,
  PORTRAIT_PIXEL_WIDTH,
  portraitKey,
  prepareUploadedImage,
  refImageToDataUrl,
  sourceKey,
  toExportBlob,
  toOneBitBlob,
  toSourceBlob,
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
}

/** Per-call knobs for the shared cache-then-generate image helper. */
interface EnsureImageOptions {
  /**
   * Publish a cached blob if there is one, but never hit the network — the
   * banner cooldown (Advanced → Location Image Cooldown) rides on this.
   */
  cacheOnly?: boolean;
  /** Ran only when a NEW image came off the wire, never on a cache hit. */
  onGenerated?: () => void;
}

/** Full-screen overlay currently shown over the chat. */
export type Screen =
  | null
  | "menu"
  | "modelkey"
  | "scenario"
  | "characters"
  | "worldnotes"
  | "journal"
  | "quests"
  | "advanced"
  | "rpg"
  | "appearance"
  | "saves"
  | "sync"
  | "party"
  | "inventory"
  | "member";

/**
 * Both devices played, both copies are real games. The prompt is the only place
 * cloud sync ever interrupts the player, and it only ever appears with both
 * games already snapshotted into save slots — so either answer is reversible.
 */
export interface SyncConflict {
  local: GameSummary;
  cloud: GameSummary;
  choose: (keep: "local" | "cloud") => void;
}

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

  hydrate: () => Promise<void>;
  setScreen: (screen: Screen) => void;
  /** Return to the previous screen (pops the navigation history). */
  goBack: () => void;
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

  /* --- Cloud sync (Menu → Cloud Sync) --- */
  /** The signed-in account, or null when signed out / sync off. */
  account: Account | null;
  syncStatus: SyncStatus;
  /** True while a sign-in / sign-up call is in flight. */
  authPending: boolean;
  /** Why the last auth attempt failed, in the player's words. */
  authError: string | null;
  /** Set after a sign-up that needs an email confirmation before it can sign in. */
  authNotice: string | null;
  /** The active-game conflict awaiting an answer — see `SyncConflict`. */
  syncConflict: SyncConflict | null;
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

  /** Ensure the banner + all in-party portraits exist (cache-then-generate). */
  syncImages: () => void;
  /** Ensure one member's portrait exists (used when a sheet opens). */
  ensurePortrait: (memberId: string) => void;
  /** Force-regenerate, replacing the cached blob. */
  regenerateBanner: () => void;
  regeneratePortrait: (memberId: string) => void;
  /**
   * Edit the cached image with a text instruction (image + text → image). The
   * banner has no such control any more — ✎ came off the top bar with ⟳ and ▲,
   * since a button parked on the art is not where a spend belongs — so this is
   * portraits only.
   */
  editPortrait: (memberId: string, instruction: string) => void;
  /** Replace a member's portrait with a user-supplied image file. */
  uploadPortrait: (memberId: string, file: Blob) => Promise<void>;
  /**
   * Drop a member's portrait entirely — cached image, master copy, and the
   * automatic re-generation that would otherwise put one straight back.
   */
  removePortrait: (memberId: string) => void;
  /**
   * Save a member's portrait to the device (share sheet / download). Resolves
   * false when there was nothing to save or the platform refused, so the sheet
   * can say so — a failed SAVE must not flag the portrait itself as broken.
   */
  downloadPortrait: (memberId: string) => Promise<boolean>;
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

/** Latest narrator prose (for banner scene flavour), else the opening beat. */
function lastNarration(game: GameState): string {
  for (let i = game.messages.length - 1; i >= 0; i--) {
    if (game.messages[i].role === "narrator") return game.messages[i].content;
  }
  return game.scenario.openingNarration;
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useStore = create<LoomStore>((set, get) => {
  /** Stored pixel width for a cache key — banners are wider than portraits. */
  const pixelWidth = (key: string) =>
    key.startsWith("banner:") ? BANNER_PIXEL_WIDTH : PORTRAIT_PIXEL_WIDTH;

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
   * Store the pre-1-bit master behind `key`, so a later edit is fed real pixels
   * instead of the tiny display copy. Every write path calls this, which is
   * also how a regeneration disowns an upload: the new master overwrites the
   * uploaded one, and the next edit can no longer reach back to it.
   */
  async function saveSource(key: string, raw: Blob) {
    try {
      const master = await toSourceBlob(raw);
      // No usable master (an undecodable or model-hostile file) → drop any
      // stale one rather than leave the previous image's master behind it.
      if (master) await saveImage(sourceKey(key), master);
      else await deleteImage(sourceKey(key));
    } catch {
      // A master copy is an optimization — losing it must not fail the image.
    }
  }

  /**
   * Master copy for an edit round-trip, falling back to the display blob. The
   * result is always something an image model will accept as an input part:
   * masters written before uploads were normalized can be any format the
   * device's gallery handed over (HEIC off an iPhone), and posting one back is
   * rejected every single time — which is what made editing an uploaded
   * portrait fail forever. Unconvertible masters fall through to the display
   * copy, which is always canvas-encoded PNG.
   */
  async function loadEditSource(key: string): Promise<Blob | null> {
    const master = await loadImage(sourceKey(key));
    if (master) {
      if (isModelSafeImage(master)) return master;
      const converted = await toSourceBlob(master);
      if (converted) return converted;
    }
    const display = await loadImage(key);
    if (!display) return null;
    if (isModelSafeImage(display)) return display;
    return await toSourceBlob(display);
  }

  /**
   * Cache-then-generate an image blob under `key`, exposing it as an object URL
   * in `images`. Fresh generations are downscaled + quantized to true 1-bit
   * before caching; already-cached blobs load as-is (regenerate reprocesses).
   * `force` skips the cache and regenerates, replacing whatever was there —
   * generated, edited, or uploaded. Fire-and-forget: every failure is swallowed
   * so an image never blocks a turn.
   */
  async function ensureImage(
    key: string,
    buildRequest: () => Pick<GenerateImageOptions, "prompt" | "images" | "aspectRatio">,
    force = false,
    opts: EnsureImageOptions = {},
  ): Promise<void> {
    if (get().imgPending[key]) return;
    if (!force && get().images[key]) return;

    // Nothing may be drawn (banner cooldown): probe the cache and stop there.
    // Deliberately ahead of `imgPending` — flagging a generation that can't
    // happen would blink "rendering…" under every suppressed banner.
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
      const blob = await toOneBitBlob(raw, pixelWidth(key), get().settings.ditherMode);
      await saveImage(key, blob);
      await saveSource(key, raw);
      publishImage(key, blob);
      opts.onGenerated?.();
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

  /**
   * Edit the cached image under `key` with a text instruction: send the master
   * copy + instruction to the image model, replace the cache with the result —
   * the edited image becomes the new image, master included, whether what it
   * replaces was generated or uploaded. Nothing cached → nothing to edit →
   * no-op. Failures are swallowed like ensureImage's — an image never blocks
   * anything.
   */
  async function editImage(key: string, instruction: string): Promise<void> {
    if (get().imgPending[key] || !instruction.trim()) return;
    // Image generation off (Model & Key): an edit is a generation like any
    // other. The ✎ button is hidden while it's off, so this is the belt to that
    // braces — nothing reaches the image model behind the switch's back. Same
    // for the ComfyUI backend, which has no edit path at all.
    if (!imageEditAllowed(get().settings)) return;
    const source = await loadEditSource(key);
    if (!source) {
      // Nothing cached at all is a plain no-op; a cached image we can't send is
      // a dead end the player has to be told about, or ✎ just does nothing.
      if (get().images[key]) {
        setImageError(key, "This image can't be edited — regenerate or upload a JPG/PNG.");
      }
      return;
    }

    // Clear any prior edit error for this key while the retry is in flight.
    setImageError(key, null);
    set({ imgPending: { ...get().imgPending, [key]: true } });
    try {
      const raw = await generateImage({
        settings: get().settings,
        prompt: buildEditPrompt(instruction),
        images: [await blobToDataUrl(source)],
        aspectRatio: key.startsWith("portrait:") ? "2:3" : undefined,
      });
      const blob = await toOneBitBlob(raw, pixelWidth(key), get().settings.ditherMode);
      await saveImage(key, blob);
      await saveSource(key, raw);
      publishImage(key, blob);
    } catch (err) {
      // Non-fatal for the turn, but a swallowed edit looks like nothing
      // happened — flag it so the UI can show a small "image failed" indicator.
      setImageError(key, imageFailure(err));
    } finally {
      clearPending(key);
    }
  }

  /**
   * Record that a location banner was drawn on the current turn — the anchor
   * the cooldown counts from. Stamped only on a real generation (never a cache
   * hit), so revisiting known locations doesn't stall the next new one.
   */
  function stampBannerTurn() {
    const game = { ...get().game, lastBannerTurn: get().game.turnNumber };
    set({ game });
    void saveActiveGame(game);
  }

  /** Abort handle for the in-flight turn (closure state — not reactive). */
  let turnAbort: AbortController | null = null;

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
   * Everything cloud sync is allowed to touch, in one place (`syncEngine.ts →
   * SyncPorts`). Built fresh on each start so the closures read live state.
   *
   * Adopting pulled data goes through the SAME writers a player edit does —
   * `saveActiveGame`, `commitCharacters`, `saveSettings` — rather than poking
   * `set` and leaving the disk copy behind. The engine suppresses its own
   * notifications while adopting, so this cannot echo.
   */
  function syncPorts(): SyncPorts {
    return {
      settings: () => get().settings,
      account: () => get().account,
      busy: () => get().streaming,
      game: () => get().game,
      async adoptGame(incoming, legacyCast) {
        // A game pushed by a build that kept the cast outside it carries none.
        // The cast in hand is the only one there is — adopting an empty one
        // would leave the pulled adventure with no player character.
        const game = legacyCast
          ? { ...incoming, characters: get().game.characters }
          : incoming;
        const lastNarrator = [...game.messages].reverse().find((m) => m.role === "narrator");
        set({
          game,
          options: lastNarrator?.appliedDeltas?.options ?? [],
          streamText: "",
          error: null,
          failedInput: null,
        });
        await saveActiveGame(game);
        // The pulled game names locations and companions this device may have
        // no art for yet; the blobs arrive in the same pass, so this publishes
        // whatever is already cached and leaves the rest to the next one.
        get().syncImages();
      },
      adoptSettings(settings) {
        saveSettings(settings);
        set({ settings });
        void mountWebFonts(settings.webFonts);
      },
      askActiveConflict(local, cloud) {
        return new Promise<"local" | "cloud">((resolve) => {
          set({
            syncConflict: {
              local,
              cloud,
              choose: (keep) => {
                set({ syncConflict: null });
                resolve(keep);
              },
            },
          });
        });
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
    // Image generation off (Model & Key): ⟳ has nothing to do, and the
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
  syncConflict: null,

  autoUpdating: false,
  autoUpdateError: null,

  fieldGenPending: false,
  journalPending: false,
  fieldGenError: null,

  async hydrate() {
    const loaded = await loadActiveGame();
    if (loaded) {
      // The one-time fold: a game stored while the cast was global has none of
      // its own, so it takes the old library wholesale. Anything that library
      // no longer has — a pre-split save still carrying its own people — is
      // folded in behind it, so no authored character is lost on the way over.
      const game = loaded.legacyCast
        ? {
            ...loaded.game,
            characters: withPC(
              mergeLibrary((await loadLegacyCharacters()) ?? [], loaded.game.characters),
            ),
          }
        : { ...loaded.game, characters: withPC(loaded.game.characters) };

      // Restore trailing options from the last narrator turn.
      const lastNarrator = [...game.messages].reverse().find((m) => m.role === "narrator");
      set({
        game,
        options: lastNarrator?.appliedDeltas?.options ?? [],
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

  setScreen(screen) {
    // Authoring edits made mid-stream get silently reverted by a later Undo
    // (the reversal is captured against the pre-turn snapshot), so block opening
    // any overlay while a turn streams — only closing (null) is allowed.
    if (screen !== null && get().streaming) return;
    const cur = get().screen;
    if (screen === cur) return;
    // Record where we came from so Back returns there, not a fixed parent.
    set({ screen, history: [...get().history, cur] });
  },

  goBack() {
    // A screen with its own internal depth (Advanced's sub-menus) gets first
    // refusal. Routing it through here rather than through the header's `onBack`
    // prop is what makes the ANDROID back button behave like the on-screen one —
    // the hardware button has no way to know about a component's local state.
    if (get().backHandler?.()) return;
    const hist = get().history;
    const prev = hist.length ? hist[hist.length - 1] : null;
    set({ screen: prev, history: hist.slice(0, -1) });
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
    // Editing the starting location/day retargets the active scene too, so the
    // header + banner follow immediately (they otherwise only move per turn).
    const location =
      patch.startLocation !== undefined ? patch.startLocation : g.location;
    const day = patch.startDay !== undefined ? patch.startDay : g.day;
    const game = { ...g, scenario, location, day };
    set({ game });
    void saveActiveGame(game);
    if (patch.startLocation !== undefined) get().syncImages();
  },

  updateCharacter(id, patch) {
    const characters = get().game.characters.map((c) => (c.id === id ? { ...c, ...patch } : c));
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

    // Free the character's portrait blob (+ its master copy) and object URL —
    // nothing references them once they're gone, so they would otherwise orphan
    // in IndexedDB.
    const key = portraitKey(id);
    void deleteImage(key);
    void deleteImage(sourceKey(key));
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
    const game = seedAdventure(get().game, imports);
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
      // into a screen called Cloud Sync to leave it off.
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
    // A pending conflict prompt belongs to a session that no longer exists.
    get().syncConflict?.choose("local");
    try {
      await authSignOut(get().settings);
    } finally {
      set({
        account: null,
        syncConflict: null,
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
    const game = loaded.legacyCast
      ? { ...loaded.game, characters: get().game.characters }
      : { ...loaded.game, characters: withPC(loaded.game.characters) };
    const lastNarrator = [...game.messages].reverse().find((m) => m.role === "narrator");
    set({
      game,
      options: lastNarrator?.appliedDeltas?.options ?? [],
      streamText: "",
      error: null,
      failedInput: null,
      screen: null,
      history: [],
    });
    void saveActiveGame(game);
    get().syncImages();
  },

  async dropSlot(id) {
    await deleteSlot(id);
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
    });

    try {
      const raw = await streamChat({
        settings: get().settings,
        messages,
        signal: turnAbort.signal,
        onDelta: (full) => set({ streamText: truncateForDisplay(full) }),
      });

      const { prose, block } = parseLoomResponse(raw);
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
      };

      set({
        game: nextGame,
        options: block?.options ?? [],
        streaming: false,
        streamText: "",
      });
      void saveActiveGame(nextGame);

      // Deterministic triggers: a new location gets a banner, new members get
      // portraits. Fire-and-forget — never blocks the turn.
      get().syncImages();

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
        options: lastNarrator?.appliedDeltas?.options ?? [],
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
      options: prevNarrator?.appliedDeltas?.options ?? [],
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
    const location = g.location.trim();
    // Location images off (Advanced → Images): nothing is generated and nothing
    // is loaded from cache, since no banner is rendered to put it in.
    if (location && get().settings.locationImages) {
      const excerpt = lastNarration(g);
      // The cooldown gates GENERATION only: a location whose banner is already
      // cached still shows it immediately, however recently we drew something.
      // Image generation being off reads the same way — cached art, no new
      // requests — so the two reasons fold into one flag.
      const cacheOnly =
        !imagesAllowed(get().settings) ||
        bannerOnCooldown(get().settings.bannerCooldown, g.lastBannerTurn, g.turnNumber);
      void ensureImage(
        bannerKey(location),
        () => ({
          prompt: buildBannerPrompt(location, excerpt, activeTemplate(get().settings)),
        }),
        false,
        { cacheOnly, onGenerated: stampBannerTurn },
      );
    }
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

  regenerateBanner() {
    const g = get().game;
    const location = g.location.trim();
    if (!location || !bannerAllowed(get().settings)) return;
    const excerpt = lastNarration(g);
    // ⟳ ignores the cooldown — but it IS a generation, so it restarts the clock.
    void ensureImage(
      bannerKey(location),
      () => ({
        prompt: buildBannerPrompt(location, excerpt, activeTemplate(get().settings)),
      }),
      true,
      { onGenerated: stampBannerTurn },
    );
  },

  regeneratePortrait(memberId) {
    portrait(memberId, true);
  },

  editPortrait(memberId, instruction) {
    void editImage(portraitKey(memberId), instruction);
  },

  async uploadPortrait(memberId, file) {
    const key = portraitKey(memberId);
    if (get().imgPending[key]) return;
    setImageError(key, null);
    set({ imgPending: { ...get().imgPending, [key]: true } });
    try {
      // Same downscale/quantize pass a generated portrait gets, so an upload
      // sits in the 1-bit look (and stays small in IndexedDB). The file itself
      // is kept as the master, so editing an upload starts from the real
      // picture and saving it out isn't limited to the display copy.
      const blob = await prepareUploadedImage(
        file,
        PORTRAIT_PIXEL_WIDTH,
        get().settings.ditherMode,
      );
      await saveImage(key, blob);
      await saveSource(key, file);
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
    // Both copies go: the display blob and its master. Leaving the master would
    // orphan a few hundred KB in IndexedDB and let a later edit resurrect art
    // the player deleted.
    void deleteImage(key);
    void deleteImage(sourceKey(key));
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

  async downloadPortrait(memberId) {
    const blob = await loadImage(portraitKey(memberId));
    if (!blob) return false;
    const name = get().game.characters.find((c) => c.id === memberId)?.name ?? "";
    try {
      // The stored blob is the display copy — a ~192px sliver that only looks
      // right because the app renders it `pixelated`. Bake that upscale into
      // the exported pixels so the saved file isn't a thumbnail.
      await saveBlobAsFile(await toExportBlob(blob), imageFileName(name));
      return true;
    } catch {
      return false;
    }
  },
  };
});
