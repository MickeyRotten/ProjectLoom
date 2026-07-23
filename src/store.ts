import { create } from "zustand";
import type { Character, GameState, Item, Message, Note, Quest, Scenario, Settings } from "./types";
import { newGame, newMember } from "./lib/defaults";
import { loadSettings, saveSettings } from "./lib/settings";
import {
  loadActiveGame,
  saveActiveGame,
  loadImage,
  saveImage,
  saveSlot,
  loadSlot,
  deleteSlot,
  listSlots,
  type SaveSlot,
} from "./lib/db";
import { buildMessages } from "./lib/prompt";
import { streamChat, OpenRouterError } from "./lib/openrouter";
import { parseLoomResponse, truncateForDisplay } from "./lib/loomBlock";
import { applyDeltas } from "./lib/deltas";
import { detectSpeakers } from "./lib/spotlight";
import {
  bannerKey,
  buildBannerPrompt,
  buildPortraitPrompt,
  generateImage,
  portraitKey,
} from "./lib/images";

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
  hydrated: boolean;

  // Turn/streaming state
  streaming: boolean;
  streamText: string;
  options: string[];
  error: string | null;

  // UI
  screen: Screen;
  /** The member whose full-screen sheet is open (screen === "member"). */
  memberId: string | null;

  // Generated images (Phase 3): cache key → object URL, plus in-flight keys.
  images: Record<string, string>;
  imgPending: Record<string, boolean>;

  // Named save slots (Phase 4).
  slots: SaveSlot[];

  hydrate: () => Promise<void>;
  setScreen: (screen: Screen) => void;
  openMember: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;

  // Authoring (Phase 4) — every edit mutates the active game, autosaved.
  updateScenario: (patch: Partial<Scenario>) => void;
  updateCharacter: (id: string, patch: Partial<Character>) => void;
  addMember: () => string;
  removeCharacter: (id: string) => void;
  addNote: () => void;
  updateNote: (id: string, patch: Partial<Note>) => void;
  removeNote: (id: string) => void;
  addQuest: () => void;
  updateQuest: (id: string, patch: Partial<Quest>) => void;
  removeQuest: (id: string) => void;
  addItem: () => void;
  updateItem: (index: number, patch: Partial<Item>) => void;
  removeItem: (index: number) => void;

  // Save slots (Phase 4) — snapshot / restore / delete of the active game.
  refreshSlots: () => Promise<void>;
  snapshotSlot: (name: string) => Promise<void>;
  restoreSlot: (id: string) => Promise<void>;
  dropSlot: (id: string) => Promise<void>;

  newAdventure: () => void;
  sendTurn: (text: string) => Promise<void>;

  /** Ensure the banner + all in-party portraits exist (cache-then-generate). */
  syncImages: () => void;
  /** Ensure one member's portrait exists (used when a sheet opens). */
  ensurePortrait: (memberId: string) => void;
  /** Force-regenerate, replacing the cached blob. */
  regenerateBanner: () => void;
  regeneratePortrait: (memberId: string) => void;
}

/** Latest narrator prose (for banner scene flavour), else the opening beat. */
function lastNarration(game: GameState): string {
  for (let i = game.messages.length - 1; i >= 0; i--) {
    if (game.messages[i].role === "narrator") return game.messages[i].content;
  }
  return game.scenario.openingNarration;
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useStore = create<LoomStore>((set, get) => {
  /**
   * Cache-then-generate an image blob under `key`, exposing it as an object URL
   * in `images`. `force` skips the cache and regenerates. Fire-and-forget:
   * every failure is swallowed so an image never blocks a turn.
   */
  async function ensureImage(
    key: string,
    buildPrompt: () => string,
    force = false,
  ): Promise<void> {
    if (get().imgPending[key]) return;
    if (!force && get().images[key]) return;

    set({ imgPending: { ...get().imgPending, [key]: true } });
    try {
      let blob = force ? null : await loadImage(key);
      if (!blob) {
        blob = await generateImage({ settings: get().settings, prompt: buildPrompt() });
        await saveImage(key, blob);
      }
      const url = URL.createObjectURL(blob);
      const prev = get().images[key];
      if (prev) URL.revokeObjectURL(prev);
      set({ images: { ...get().images, [key]: url } });
    } catch {
      // Non-fatal — a failed image never blocks the turn (DESIGN.md).
    } finally {
      const imgPending = { ...get().imgPending };
      delete imgPending[key];
      set({ imgPending });
    }
  }

  const portrait = (memberId: string, force: boolean) => {
    const member = get().game.characters.find((c) => c.id === memberId);
    if (!member) return;
    void ensureImage(
      portraitKey(member.id),
      () => buildPortraitPrompt(member, get().settings.portraitInstructions),
      force,
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

  screen: null,
  memberId: null,

  images: {},
  imgPending: {},

  slots: [],

  async hydrate() {
    const saved = await loadActiveGame();
    if (saved) {
      // Restore trailing options from the last narrator turn.
      const lastNarrator = [...saved.messages].reverse().find((m) => m.role === "narrator");
      set({
        game: saved,
        options: lastNarrator?.appliedDeltas?.options ?? [],
        hydrated: true,
      });
    } else {
      set({ hydrated: true });
      void saveActiveGame(get().game);
    }
    get().syncImages();
  },

  setScreen(screen) {
    set({ screen });
  },

  openMember(id) {
    set({ screen: "member", memberId: id });
  },

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings);
    set({ settings });
  },

  updateScenario(patch) {
    const g = get().game;
    const game = { ...g, scenario: { ...g.scenario, ...patch } };
    set({ game });
    void saveActiveGame(game);
  },

  updateCharacter(id, patch) {
    const g = get().game;
    const characters = g.characters.map((c) => (c.id === id ? { ...c, ...patch } : c));
    const game = { ...g, characters };
    set({ game });
    void saveActiveGame(game);
  },

  addMember() {
    const g = get().game;
    const member = newMember(uid());
    const game = { ...g, characters: [...g.characters, member] };
    set({ game });
    void saveActiveGame(game);
    return member.id;
  },

  removeCharacter(id) {
    const g = get().game;
    // The PC is never deletable — only party members.
    const target = g.characters.find((c) => c.id === id);
    if (!target || target.role === "pc") return;
    const characters = g.characters.filter((c) => c.id !== id);
    const game = { ...g, characters };
    set({ game, screen: get().screen === "member" ? "characters" : get().screen });
    void saveActiveGame(game);
  },

  addNote() {
    const g = get().game;
    const note: Note = { id: uid(), title: "", keywords: [], content: "" };
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

  newAdventure() {
    const game = newGame(get().game.scenario);
    set({ game, options: [], streamText: "", error: null });
    void saveActiveGame(game);
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
    const game = await loadSlot(id);
    if (!game) return;
    const lastNarrator = [...game.messages].reverse().find((m) => m.role === "narrator");
    set({
      game,
      options: lastNarrator?.appliedDeltas?.options ?? [],
      streamText: "",
      error: null,
      screen: null,
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
      streaming: true,
      streamText: "",
    });

    // Build from `base` (pre-turn history) so the new line isn't duplicated —
    // it rides as the final user message, not also inside the history window.
    const messages = buildMessages({
      settings: get().settings,
      game: base,
      playerMessage: trimmed,
    });

    try {
      const raw = await streamChat({
        settings: get().settings,
        messages,
        onDelta: (full) => set({ streamText: truncateForDisplay(full) }),
      });

      const { prose, block } = parseLoomResponse(raw);
      const g = get().game;
      const scene = block ? applyDeltas(g, block) : null;

      // Party deltas apply first, THEN deterministic speaker detection bumps
      // lastSpokeTurn — the model's `spoke` hint never overrides the prose
      // (loom-spotlight). Run against the post-delta in-party roster.
      let characters = scene?.characters ?? g.characters;
      const party = characters.filter((c) => c.role === "member" && c.inParty);
      const spokeIds = new Set(detectSpeakers(prose, party));
      if (spokeIds.size) {
        characters = characters.map((c) =>
          spokeIds.has(c.id) ? { ...c, lastSpokeTurn: turn } : c,
        );
      }

      const narratorMsg: Message = {
        id: uid(),
        role: "narrator",
        content: prose || raw.trim(),
        turn,
        appliedDeltas: block ?? undefined,
        day: scene?.day ?? g.day,
        location: scene?.location ?? g.location,
        weather: scene?.weather ?? g.weather,
      };

      const nextGame: GameState = {
        ...g,
        messages: [...g.messages, narratorMsg],
        characters,
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
      const message =
        err instanceof OpenRouterError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Turn failed.";
      set({ streaming: false, streamText: "", error: message });
    }
  },

  syncImages() {
    const g = get().game;
    const location = g.location.trim();
    if (location) {
      const excerpt = lastNarration(g);
      void ensureImage(bannerKey(location), () =>
        buildBannerPrompt(location, excerpt, get().settings.bannerInstructions),
      );
    }
    for (const c of g.characters) {
      if (c.role === "member" && c.inParty) portrait(c.id, false);
    }
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
      () => buildBannerPrompt(location, excerpt, get().settings.bannerInstructions),
      true,
    );
  },

  regeneratePortrait(memberId) {
    portrait(memberId, true);
  },
  };
});
