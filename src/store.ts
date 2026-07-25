import { create } from "zustand";
import type {
  Character,
  CharacterOverride,
  CharacterStatus,
  GameState,
  Item,
  Message,
  Note,
  Quest,
  Scenario,
  Settings,
} from "./types";
import { defaultPC, ensureGold, newCharacter, newGame } from "./lib/defaults";
import { loadSettings, saveSettings } from "./lib/settings";
import {
  loadActiveGame,
  loadCharacters,
  saveActiveGame,
  saveCharacters,
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
  clearOverrides as clearRosterOverrides,
  dropEntry,
  getEntry,
  mergeOverrides,
  partyFull,
  partyMembers,
  resolve,
  setEntry,
} from "./lib/roster";
import { buildMessages } from "./lib/prompt";
import { completeChat, streamChat, OpenRouterError } from "./lib/openrouter";
import {
  AUTO_UPDATE_TEMPERATURE,
  buildAutoUpdateMessages,
  normalizeFields,
  parseAutoUpdate,
  type AutoField,
} from "./lib/autoUpdate";
import { parseLoomResponse, truncateForDisplay } from "./lib/loomBlock";
import { applyDeltas } from "./lib/deltas";
import { captureReversal, applyReversal } from "./lib/reversal";
import { detectSpeakers } from "./lib/spotlight";
import {
  BANNER_PIXEL_WIDTH,
  bannerKey,
  blobToDataUrl,
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
import { imageFileName, saveBlobAsFile } from "./lib/download";

/** Full-screen overlay currently shown over the chat. */
export type Screen =
  | null
  | "menu"
  | "modelkey"
  | "scenario"
  | "characters"
  | "worldnotes"
  | "quests"
  | "advanced"
  | "saves"
  | "party"
  | "inventory"
  | "member";

export interface LoomStore {
  settings: Settings;
  game: GameState;
  /**
   * The GLOBAL character library — every character ever authored or written
   * into the story, independent of any adventure. `game.roster` says which of
   * them are travelling with the player right now.
   */
  characters: Character[];
  hydrated: boolean;

  // Turn/streaming state
  streaming: boolean;
  streamText: string;
  options: string[];
  error: string | null;
  /** The input of the last failed/stopped turn, so it can be retried verbatim. */
  failedInput: string | null;

  // UI
  screen: Screen;
  /** Screens navigated away from — Back pops this so it returns to wherever
   *  you actually came from, not a hard-coded parent. */
  history: Screen[];
  /** The member whose full-screen sheet is open (screen === "member"). */
  memberId: string | null;

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

  hydrate: () => Promise<void>;
  setScreen: (screen: Screen) => void;
  /** Return to the previous screen (pops the navigation history). */
  goBack: () => void;
  openMember: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;

  // Authoring (Phase 4) — every edit mutates the active game, autosaved.
  updateScenario: (patch: Partial<Scenario>) => void;
  /**
   * Player-authored edit: writes the global character, and drops any story
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
  /** Delete a character from the library entirely (and from every adventure). */
  removeCharacter: (id: string) => void;
  /**
   * Add to / kick from the active party, capped at PARTY_LIMIT. Kicking only
   * ends party membership — the character stays in Characters.
   */
  setInParty: (id: string, inParty: boolean) => void;
  /** Player-set standing for this adventure (active / departed / fallen). */
  setStatus: (id: string, status: CharacterStatus) => void;
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

  // Save slots (Phase 4) — snapshot / restore / delete of the active game.
  refreshSlots: () => Promise<void>;
  snapshotSlot: (name: string) => Promise<void>;
  restoreSlot: (id: string) => Promise<void>;
  dropSlot: (id: string) => Promise<void>;

  newAdventure: () => void;
  sendTurn: (text: string) => Promise<void>;
  /** Re-send the input of the last failed turn. */
  retryTurn: () => void;
  /** Abort the in-flight turn; the input rolls back and becomes retryable. */
  stopTurn: () => void;

  // Reversal (Phase 5) — unwind the latest turn's applied deltas.
  /** Drop the latest turn (player + narrator), restoring pre-turn scene state. */
  undoLastTurn: () => void;
  /** Re-run the latest turn's player input for a fresh narration (swipe). */
  regenerateLastTurn: () => void;
  /** Overwrite one message's prose in place (edit the latest narration). */
  editMessage: (id: string, content: string) => void;
  /** Edit the latest player input: unwind the turn, then re-send the new text. */
  editUserTurn: (text: string) => void;

  /** Ensure the banner + all in-party portraits exist (cache-then-generate). */
  syncImages: () => void;
  /** Ensure one member's portrait exists (used when a sheet opens). */
  ensurePortrait: (memberId: string) => void;
  /** Force-regenerate, replacing the cached blob. */
  regenerateBanner: () => void;
  regeneratePortrait: (memberId: string) => void;
  /** Edit the cached image with a text instruction (image + text → image). */
  editBanner: (instruction: string) => void;
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
  "description",
  "personality",
  "drive",
  "strengths",
];

/** Latest narrator prose (for banner scene flavour), else the opening beat. */
function lastNarration(game: GameState): string {
  for (let i = game.messages.length - 1; i >= 0; i--) {
    if (game.messages[i].role === "narrator") return game.messages[i].content;
  }
  return game.scenario.openingNarration;
}

/**
 * Fold characters recovered from a legacy save into the stored library.
 * Whoever is already in the library wins — the save may be older than an edit.
 */
function mergeLibrary(library: Character[], recovered: Character[]): Character[] {
  const known = new Set(library.map((c) => c.id));
  const extra = recovered.filter((c) => !known.has(c.id));
  return extra.length ? [...library, ...extra] : library;
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
  ): Promise<void> {
    if (get().imgPending[key]) return;
    if (!force && get().images[key]) return;

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
    } catch (err) {
      // Non-fatal — a failed image never blocks the turn (DESIGN.md). A forced
      // regeneration is different: swallowing it silently leaves the OLD image
      // on screen, which reads as "⟳ refused to replace my picture", so say so —
      // with the reason, since "failed" alone leaves nothing to act on.
      if (force) setImageError(key, imageFailure(err));
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

  /** Abort handle for the in-flight turn (closure state — not reactive). */
  let turnAbort: AbortController | null = null;

  /** Persist the library alongside whatever game slice just changed. */
  function commitCharacters(characters: Character[]) {
    set({ characters });
    void saveCharacters(characters);
  }

  const portrait = (memberId: string, force: boolean) => {
    const base = get().characters.find((c) => c.id === memberId);
    if (!base) return;
    // A removed portrait stays removed: the automatic trigger is "no cached
    // image → draw one", so without this the next turn would silently undo the
    // player's removal. Only ⟳ (force) or an upload overrides it.
    if (!force && base.noPortrait) return;
    if (force && base.noPortrait) {
      commitCharacters(
        get().characters.map((c) => (c.id === memberId ? { ...c, noPortrait: false } : c)),
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
          prompt: buildPortraitPrompt(
            member,
            {
              action: s.portraitAction,
              context: s.portraitContext,
              composition: s.portraitComposition,
              style: s.portraitStyle,
            },
            refs.length ? s.portraitRefInstruction : undefined,
          ),
          images: refs.length ? refs : undefined,
          aspectRatio: "2:3",
        };
      },
      force,
    );
  };

  return {
  settings: loadSettings(),
  game: newGame(),
  characters: [defaultPC()],
  hydrated: false,

  streaming: false,
  streamText: "",
  options: [],
  error: null,
  failedInput: null,

  screen: null,
  history: [],
  memberId: null,

  images: {},
  imgPending: {},
  imgError: {},

  slots: [],

  autoUpdating: false,
  autoUpdateError: null,

  async hydrate() {
    const stored = await loadCharacters();
    const loaded = await loadActiveGame();

    // The library is authoritative; a pre-split save contributes any character
    // it still holds that the library has never seen. Existing ids win, so a
    // character edited since the save is never clobbered by the old copy.
    const characters = mergeLibrary(stored ?? [], loaded?.characters ?? []);
    const library = characters.length ? characters : [defaultPC()];

    if (loaded) {
      // Restore trailing options from the last narrator turn.
      const lastNarrator = [...loaded.game.messages]
        .reverse()
        .find((m) => m.role === "narrator");
      set({
        game: loaded.game,
        characters: library,
        options: lastNarrator?.appliedDeltas?.options ?? [],
        hydrated: true,
      });
      void saveActiveGame(loaded.game);
    } else {
      set({ characters: library, hydrated: true });
      void saveActiveGame(get().game);
    }
    void saveCharacters(library);
    get().syncImages();
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
    const hist = get().history;
    const prev = hist.length ? hist[hist.length - 1] : null;
    set({ screen: prev, history: hist.slice(0, -1) });
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
    const characters = get().characters.map((c) => (c.id === id ? { ...c, ...patch } : c));
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
    commitCharacters([...get().characters, character]);
    return character.id;
  },

  async autoUpdateCharacter(id, fields) {
    const selected = normalizeFields(fields);
    // A turn in flight owns the roster (its reversal snapshot is already
    // captured), so a sheet rewrite mid-stream would be silently undone.
    if (!selected.length || get().autoUpdating || get().streaming) return false;
    const base = get().characters.find((c) => c.id === id);
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
      if (!get().characters.some((c) => c.id === id)) {
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

  removeCharacter(id) {
    // The PC is never deletable — only other characters.
    const target = get().characters.find((c) => c.id === id);
    if (!target || target.role === "pc") return;
    commitCharacters(get().characters.filter((c) => c.id !== id));

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

  setInParty(id, inParty) {
    const g = get().game;
    const target = get().characters.find((c) => c.id === id);
    if (!target || target.role !== "member") return;
    // Joining is capped by the strip's slots; leaving is always allowed.
    if (inParty && !getEntry(g.roster, id).inParty && partyFull(g.roster)) return;
    // Bringing someone back is the player overruling how they left, so their
    // departed/fallen standing clears; kicking records a plain departure.
    const roster = setEntry(g.roster, id, {
      inParty,
      status: inParty ? "active" : "departed",
    });
    if (roster === g.roster) return;
    const game = { ...g, roster };
    set({ game });
    void saveActiveGame(game);
    // A freshly added member needs a portrait for the strip.
    if (inParty) get().syncImages();
  },

  setStatus(id, status) {
    const g = get().game;
    // Someone travelling with you is by definition still with you.
    const roster = setEntry(g.roster, id, {
      status,
      inParty: status === "active" ? getEntry(g.roster, id).inParty : false,
    });
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

  newAdventure() {
    // Reseed from the current scenario. Characters are global and untouched —
    // the whole cast survives, but the PARTY starts empty (roster: []) and is
    // rebuilt from Characters or by the narrator recruiting during play.
    const g = get().game;
    const game = newGame(g.scenario);
    set({ game, options: [], streamText: "", error: null, failedInput: null });
    void saveActiveGame(game);
    get().syncImages();
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
    const { game } = loaded;
    // A slot restores an ADVENTURE, never the cast — characters authored since
    // the snapshot must survive it. A pre-split slot still carries characters,
    // so fold in any the library has never seen.
    const library = mergeLibrary(get().characters, loaded.characters);
    if (library !== get().characters) commitCharacters(library);
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

  async sendTurn(text) {
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

    // Build from `base` (pre-turn history) so the new line isn't duplicated —
    // it rides as the final user message, not also inside the history window.
    const messages = buildMessages({
      settings: get().settings,
      game: base,
      characters: get().characters,
      playerMessage: trimmed,
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
      const library = get().characters;
      const scene = block ? applyDeltas(g, library, block) : null;

      // Party deltas apply first, THEN deterministic speaker detection bumps
      // lastSpokeTurn — the model's `spoke` hint never overrides the prose
      // (loom-spotlight). Run against the post-delta in-party roster.
      const characters = scene?.characters ?? library;
      let roster = scene?.roster ?? g.roster;
      const party = partyMembers(characters, roster);
      const spokeIds = new Set(detectSpeakers(prose, party));
      for (const id of spokeIds) roster = setEntry(roster, id, { lastSpokeTurn: turn });

      // A turn may have written new characters into the global library.
      if (characters !== library) commitCharacters(characters);

      // Reference-diff the pre-turn slices (base) against the post-turn ones so
      // undo/regenerate can restore exactly what this turn overwrote (Phase 5).
      const post = {
        ...base,
        roster,
        inventory: scene?.inventory ?? g.inventory,
        quests: scene?.quests ?? g.quests,
        day: scene?.day ?? g.day,
        location: scene?.location ?? g.location,
        weather: scene?.weather ?? g.weather,
      };
      const reversal = captureReversal(base, post);

      const narratorMsg: Message = {
        id: uid(),
        role: "narrator",
        content: prose || raw.trim(),
        turn,
        appliedDeltas: block ?? undefined,
        reversal,
        day: scene?.day ?? g.day,
        location: scene?.location ?? g.location,
        weather: scene?.weather ?? g.weather,
      };

      const nextGame: GameState = {
        ...g,
        messages: [...g.messages, narratorMsg],
        roster,
        day: scene?.day ?? g.day,
        location: scene?.location ?? g.location,
        weather: scene?.weather ?? g.weather,
        inventory: scene?.inventory ?? g.inventory,
        quests: scene?.quests ?? g.quests,
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

    // Drop both messages of that turn; restore options from the now-latest beat.
    const messages = g.messages.filter((m) => m.turn !== narrator.turn);
    const prevNarrator = [...messages].reverse().find((m) => m.role === "narrator");
    const turnNumber = messages.reduce((max, m) => Math.max(max, m.turn), 0);

    const game: GameState = { ...restored, messages, turnNumber };
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

  regenerateLastTurn() {
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
    get().undoLastTurn();
    if (player) void get().sendTurn(player.content);
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
    if (location) {
      const excerpt = lastNarration(g);
      void ensureImage(bannerKey(location), () => ({
        prompt: buildBannerPrompt(location, excerpt, get().settings.bannerInstructions),
      }));
    }
    // The PC rides the strip too, so its portrait must generate up front — not
    // only after the PC sheet is opened once. Characters outside the party get
    // theirs lazily, when their sheet opens.
    const chars = get().characters;
    for (const c of chars) if (c.role === "pc") portrait(c.id, false);
    for (const m of partyMembers(chars, g.roster)) portrait(m.id, false);
  },

  ensurePortrait(memberId) {
    portrait(memberId, false);
  },

  regenerateBanner() {
    const g = get().game;
    const location = g.location.trim();
    if (!location) return;
    const excerpt = lastNarration(g);
    void ensureImage(
      bannerKey(location),
      () => ({
        prompt: buildBannerPrompt(location, excerpt, get().settings.bannerInstructions),
      }),
      true,
    );
  },

  regeneratePortrait(memberId) {
    portrait(memberId, true);
  },

  editBanner(instruction) {
    const location = get().game.location.trim();
    if (!location) return;
    void editImage(bannerKey(location), instruction);
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
      if (get().characters.some((c) => c.id === memberId && c.noPortrait)) {
        commitCharacters(
          get().characters.map((c) => (c.id === memberId ? { ...c, noPortrait: false } : c)),
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
      get().characters.map((c) => (c.id === memberId ? { ...c, noPortrait: true } : c)),
    );
  },

  async downloadPortrait(memberId) {
    const blob = await loadImage(portraitKey(memberId));
    if (!blob) return false;
    const name = get().characters.find((c) => c.id === memberId)?.name ?? "";
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
