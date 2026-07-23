import { create } from "zustand";
import type { GameState, Message, Settings } from "./types";
import { newGame } from "./lib/defaults";
import { loadSettings, saveSettings } from "./lib/settings";
import { loadActiveGame, saveActiveGame } from "./lib/db";
import { buildMessages } from "./lib/prompt";
import { streamChat, OpenRouterError } from "./lib/openrouter";
import { parseLoomResponse, truncateForDisplay } from "./lib/loomBlock";
import { applyDeltas } from "./lib/deltas";

/** Full-screen overlay currently shown over the chat (Phase 1: settings only). */
export type Screen = null | "settings";

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

  hydrate: () => Promise<void>;
  setScreen: (screen: Screen) => void;
  updateSettings: (patch: Partial<Settings>) => void;
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

  updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings);
    set({ settings });
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
