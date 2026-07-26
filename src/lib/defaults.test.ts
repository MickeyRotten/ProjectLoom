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
  newCharacter,
  newGame,
  splitLegacyGame,
  STARTING_GOLD,
} from "./defaults";
import type { GameState } from "../types";

describe("newGame — a fresh adventure", () => {
  it("starts with an empty party; the cast lives in the global library", () => {
    expect(newGame().roster).toEqual([]);
  });

  it("seeds no characters of its own", () => {
    expect(newGame()).not.toHaveProperty("characters");
  });
});

describe("newCharacter", () => {
  it("creates a member outside the party — you add them from Characters", () => {
    const c = newCharacter("m-1");
    expect(c.role).toBe("member");
    expect(c).not.toHaveProperty("inParty");
    expect(c).not.toHaveProperty("lastSpokeTurn");
  });
});

describe("splitLegacyGame", () => {
  it("returns null for a missing save", () => {
    expect(splitLegacyGame(undefined)).toBeNull();
    expect(splitLegacyGame(null)).toBeNull();
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
    const { game } = splitLegacyGame(old)!;
    expect(game.worldNotes).toEqual([]);
    // Pre-Gold saves gain the permanent currency row.
    expect(game.inventory).toEqual([goldItem()]);
    expect(game.quests).toEqual([]);
    expect(game.scenario.title).toBeTruthy();
    expect(game.location).toBe("Old Well");
    expect(game.turnNumber).toBe(3);
  });

  it("merges a partial scenario over the default one", () => {
    const old = { scenario: { title: "My World" } } as Partial<GameState>;
    const { game } = splitLegacyGame(old)!;
    expect(game.scenario.title).toBe("My World");
    expect(game.scenario.openingNarration).toBeTruthy();
    expect(game.scenario.startLocation).toBeTruthy();
  });

  it("passes a post-split game through unchanged", () => {
    const current = newGame();
    current.quests = [{ id: "q1", label: "Find it", description: "", reward: "", status: "active" }];
    const { game, characters } = splitLegacyGame(current)!;
    expect(game.quests).toEqual(current.quests);
    expect(game.roster).toEqual([]);
    expect(characters).toEqual([]);
  });

  it("lifts a pre-split roster into the library plus adventure entries", () => {
    const legacy = {
      characters: [
        { ...defaultPC(), lastSpokeTurn: 4 },
        { ...newCharacter("m-navi"), name: "Navi", inParty: true, lastSpokeTurn: 7 },
        { ...newCharacter("m-bel"), name: "Bel", inParty: false, lastSpokeTurn: 0 },
      ],
    };
    const { game, characters } = splitLegacyGame(legacy)!;

    // Ids are preserved, so every existing portrait blob keeps resolving.
    expect(characters.map((c) => c.id)).toEqual(["pc", "m-navi", "m-bel"]);
    // Party state moved off the character and onto the adventure.
    for (const c of characters) {
      expect(c).not.toHaveProperty("inParty");
      expect(c).not.toHaveProperty("lastSpokeTurn");
    }
    expect(game.roster).toEqual([
      { id: "pc", standing: "none", lastSpokeTurn: 4 },
      { id: "m-navi", standing: "active", lastSpokeTurn: 7 },
      { id: "m-bel", standing: "none", lastSpokeTurn: 0 },
    ]);
    // The legacy array must not ride along into the re-saved game.
    expect(game).not.toHaveProperty("characters");
  });

  it("folds a pre-ladder roster's inParty + status into one standing", () => {
    // Saves written after the Characters/Party split but before standings.
    const saved = {
      roster: [
        { id: "m-navi", inParty: true, lastSpokeTurn: 7, status: "active" },
        { id: "m-bel", inParty: false, lastSpokeTurn: 0, status: "fallen" },
        // The old nowhere-state an over-cap join used to write.
        { id: "m-cid", inParty: false, lastSpokeTurn: 0, status: "active" },
      ],
    };
    const { game } = splitLegacyGame(saved)!;
    expect(game.roster).toEqual([
      { id: "m-navi", standing: "active", lastSpokeTurn: 7 },
      { id: "m-bel", standing: "fallen", lastSpokeTurn: 0 },
      { id: "m-cid", standing: "none", lastSpokeTurn: 0 },
    ]);
  });

  it("folds a legacy fieldSkill into the one-line strengths and drops likes/dislikes", () => {
    const legacy = {
      characters: [
        {
          ...defaultPC(),
          strengths: undefined,
          fieldSkill: { name: "Superhuman Strength", description: "lifts anything" },
          likes: "Adventure",
          dislikes: "Boredom",
        },
      ],
    };
    const c = splitLegacyGame(legacy)!.characters[0];
    expect(c.strengths).toBe("Superhuman Strength — lifts anything");
    expect(c).not.toHaveProperty("fieldSkill");
    expect(c).not.toHaveProperty("likes");
    expect(c).not.toHaveProperty("dislikes");
  });

  it("gives a character with neither field a blank strengths", () => {
    const legacy = { characters: [{ ...defaultPC(), strengths: undefined }] };
    expect(splitLegacyGame(legacy)!.characters[0].strengths).toBe("");
  });

  it("folds a labelled strengths object into one line and loads flaws blank", () => {
    const legacy = {
      characters: [
        {
          ...defaultPC(),
          strengths: { name: "Lockpicking", description: "opens anything" },
          flaws: undefined,
        },
      ],
    };
    const c = splitLegacyGame(legacy)!.characters[0];
    expect(c.strengths).toBe("Lockpicking — opens anything");
    expect(c.flaws).toBe("");
  });

  it("keeps an existing Gold row (and its quantity) on migrate", () => {
    const current = newGame();
    current.inventory = [{ label: "Gold", description: "Currency", quantity: 77 }];
    const { game } = splitLegacyGame(current)!;
    expect(game.inventory).toHaveLength(1);
    expect(game.inventory[0].quantity).toBe(77);
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

  it("default settings ship clean threshold and zero reference images", () => {
    const s = defaultSettings();
    expect(s.ditherMode).toBe("threshold");
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
