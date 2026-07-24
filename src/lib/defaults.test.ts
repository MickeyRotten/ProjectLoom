import { describe, it, expect } from "vitest";
import {
  DEFAULT_BANNER_INSTRUCTIONS,
  DEFAULT_PORTRAIT_ACTION,
  DEFAULT_PORTRAIT_COMPOSITION,
  DEFAULT_PORTRAIT_CONTEXT,
  DEFAULT_PORTRAIT_STYLE,
  DEFAULT_REFERENCE_INSTRUCTION,
  defaultPC,
  defaultSettings,
  ensureGold,
  goldItem,
  isGold,
  migrateGame,
  newGame,
  newMember,
  STARTING_GOLD,
} from "./defaults";
import type { GameState } from "../types";

describe("newGame — roster carry-over", () => {
  it("seeds the default PC when no roster is passed", () => {
    const g = newGame();
    expect(g.characters).toHaveLength(1);
    expect(g.characters[0].role).toBe("pc");
  });

  it("carries an authored roster into the new game with lastSpokeTurn reset", () => {
    const pc = { ...defaultPC(), name: "Vale" };
    const ally = { ...newMember("m-1"), name: "Navi", lastSpokeTurn: 7 };
    const g = newGame(undefined, [pc, ally]);
    expect(g.characters.map((c) => c.name)).toEqual(["Vale", "Navi"]);
    expect(g.characters.every((c) => c.lastSpokeTurn === 0)).toBe(true);
  });
});

describe("migrateGame", () => {
  it("returns null for a missing save", () => {
    expect(migrateGame(undefined)).toBeNull();
    expect(migrateGame(null)).toBeNull();
  });

  it("fills slices missing from an older-shape save", () => {
    const old = {
      characters: [defaultPC()],
      messages: [],
      turnNumber: 3,
      day: 2,
      location: "Old Well",
      weather: "rain",
      // no scenario/worldNotes/inventory/quests — pre-Phase-4 shape
    };
    const g = migrateGame(old)!;
    expect(g.worldNotes).toEqual([]);
    // Pre-Gold saves gain the permanent currency row.
    expect(g.inventory).toEqual([goldItem()]);
    expect(g.quests).toEqual([]);
    expect(g.scenario.title).toBeTruthy();
    expect(g.location).toBe("Old Well");
    expect(g.turnNumber).toBe(3);
  });

  it("merges a partial scenario over the default one", () => {
    const old = { scenario: { title: "My World" } } as Partial<GameState>;
    const g = migrateGame(old)!;
    expect(g.scenario.title).toBe("My World");
    expect(g.scenario.openingNarration).toBeTruthy();
    expect(g.scenario.startLocation).toBeTruthy();
  });

  it("passes a current-shape game through unchanged", () => {
    const current = newGame();
    current.quests = [{ id: "q1", label: "Find it", description: "", reward: "", status: "active" }];
    const g = migrateGame(current)!;
    expect(g.quests).toEqual(current.quests);
    expect(g.characters).toEqual(current.characters);
  });

  it("keeps an existing Gold row (and its quantity) on migrate", () => {
    const current = newGame();
    current.inventory = [{ label: "Gold", description: "Currency", quantity: 77 }];
    const g = migrateGame(current)!;
    expect(g.inventory).toHaveLength(1);
    expect(g.inventory[0].quantity).toBe(77);
  });
});

describe("image prompt constants — hard constraints", () => {
  const prompts = [
    DEFAULT_BANNER_INSTRUCTIONS,
    DEFAULT_PORTRAIT_ACTION,
    DEFAULT_PORTRAIT_CONTEXT,
    DEFAULT_PORTRAIT_COMPOSITION,
    DEFAULT_PORTRAIT_STYLE,
    DEFAULT_REFERENCE_INSTRUCTION,
  ];

  it("never mentions pixels — pixelation is client-side post-processing", () => {
    for (const p of prompts) expect(p.toLowerCase()).not.toContain("pixel");
  });

  it("style clause carries no character-specific anatomy or gear language", () => {
    const style = DEFAULT_PORTRAIT_STYLE.toLowerCase();
    for (const word of ["heroic", "pauldron", "gauntlet", "jaw", "bust", "muscul", "armor"]) {
      expect(style).not.toContain(word);
    }
  });

  it("default settings ship dither mode on and zero reference images", () => {
    const s = defaultSettings();
    expect(s.ditherMode).toBe("bayer4");
    expect(s.portraitRefImages).toEqual([]);
    expect(s.portraitRefInstruction).toBe(DEFAULT_REFERENCE_INSTRUCTION);
  });
});

describe("Gold — permanent currency", () => {
  it("seeds a fresh game with the Gold row", () => {
    const g = newGame();
    expect(g.inventory.some((it) => isGold(it.label))).toBe(true);
    expect(g.inventory.find((it) => isGold(it.label))?.quantity).toBe(STARTING_GOLD);
  });

  it("isGold matches case-insensitively, other labels do not", () => {
    expect(isGold("Gold")).toBe(true);
    expect(isGold(" gold ")).toBe(true);
    expect(isGold("Golden Idol")).toBe(false);
  });

  it("ensureGold prepends the row only when missing", () => {
    const withGold = [goldItem(5)];
    expect(ensureGold(withGold)).toBe(withGold);
    const restored = ensureGold([{ label: "Rope", description: "", quantity: 1 }]);
    expect(isGold(restored[0].label)).toBe(true);
    expect(restored).toHaveLength(2);
  });
});
