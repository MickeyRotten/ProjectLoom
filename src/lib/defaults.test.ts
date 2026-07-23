import { describe, it, expect } from "vitest";
import { defaultPC, migrateGame, newGame, newMember } from "./defaults";
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
    expect(g.inventory).toEqual([]);
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
});
