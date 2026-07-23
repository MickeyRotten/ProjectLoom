import { create } from "zustand";
import type { Character, GameState, Item, Message, Settings } from "./types";
import { newGame } from "./lib/defaults";
import { loadSettings, saveSettings } from "./lib/settings";
import { loadActiveGame, saveActiveGame } from "./lib/db";
import { buildMessages } from "./lib/prompt";
import { streamChat, OpenRouterError } from "./lib/openrouter";
import { parseLoomResponse, truncateForDisplay } from "./lib/loomBlock";
import { applyDeltas } from "./lib/deltas";
import { detectSpeakers } from "./lib/spotlight";

/** Full-screen overlay currently shown over the chat. */
export type Screen = null | "settings" | "party" | "inventory" | "member";

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

  hydrate: () => Promise<void>;
  setScreen: (screen: Screen) => void;
  openMember: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  updateCharacter: (id: string, patch: Partial<Character>) => void;
  updateItem: (index: number, patch: Partial<Item>) => void;
  removeItem: (index: number) => void;
  newAdventure: () => void;
  sendTurn: (text: string) => Promise<void>;
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useStore = create<LoomStore>((set, get) => ({
  settings: loadSettings(),
  game: newGame(),
  hydrated: false,

  streaming: false,
  streamText: "",
  options: [],
  error: null,

  screen: null,
  memberId: null,

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

  updateCharacter(id, patch) {
    const g = get().game;
    const characters = g.characters.map((c) => (c.id === id ? { ...c, ...patch } : c));
    const game = { ...g, characters };
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
}));
