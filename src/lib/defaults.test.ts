import { describe, it, expect } from "vitest";
import {
  defaultPC,
  defaultSettings,
  ensureGold,
  goldItem,
  isGold,
  migrateCharacter,
  newCharacter,
  newGame,
  loadGame,
  seedAdventure,
  withPC,
  DEFAULT_ADVENTURE_IMPORTS,
  DEFAULT_SCENARIO,
  STARTING_GOLD,
} from "./defaults";
import type { AdventureImports, GameState } from "../types";

describe("newGame — a fresh adventure", () => {
  it("starts with an empty party", () => {
    expect(newGame().roster).toEqual([]);
  });

  it("carries a cast of its own — the PC and nobody else", () => {
    expect(newGame().characters.map((c) => c.role)).toEqual(["pc"]);
  });

  it("takes the cast it is handed", () => {
    const cast = [defaultPC(), newCharacter("m-1")];
    expect(newGame(DEFAULT_SCENARIO, cast).characters).toBe(cast);
  });
});

describe("withPC", () => {
  it("leaves a cast that already has one alone", () => {
    const cast = [defaultPC(), newCharacter("m-1")];
    expect(withPC(cast)).toBe(cast);
  });

  it("prepends the shipped PC to a cast of companions", () => {
    const out = withPC([newCharacter("m-1")]);
    expect(out.map((c) => c.role)).toEqual(["pc", "member"]);
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

describe("migrateCharacter — player notes", () => {
  it("loads a record written before Notes existed with a blank one", () => {
    expect(migrateCharacter({ ...newCharacter("m-1"), notes: undefined }).notes).toBe("");
  });

  it("keeps what the player wrote", () => {
    const stored = { ...newCharacter("m-1"), notes: "do not let him die" };
    expect(migrateCharacter(stored).notes).toBe("do not let him die");
  });
});

describe("loadGame", () => {
  it("returns null for a missing save", () => {
    expect(loadGame(undefined)).toBeNull();
    expect(loadGame(null)).toBeNull();
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
    const { game } = loadGame(old)!;
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
    const { game } = loadGame(old)!;
    expect(game.scenario.title).toBe("My World");
    expect(game.scenario.openingNarration).toBeTruthy();
    expect(game.scenario.startLocation).toBeTruthy();
  });

  it("passes a current-shape game through unchanged", () => {
    const current = newGame();
    current.quests = [{ id: "q1", label: "Find it", description: "", reward: "", status: "active" }];
    const { game, legacyCast } = loadGame(current)!;
    expect(game.quests).toEqual(current.quests);
    expect(game.roster).toEqual([]);
    expect(game.characters.map((c) => c.id)).toEqual(["pc"]);
    expect(legacyCast).toBe(false);
  });

  it("flags a game stored while the cast was global, and leaves it empty", () => {
    // The split era: characters lived in their own store, so the document has
    // no `characters` key at all. The caller has to supply one.
    const { game, legacyCast } = loadGame({ turnNumber: 2, roster: [] })!;
    expect(legacyCast).toBe(true);
    expect(game.characters).toEqual([]);
  });

  it("lifts a pre-split roster into the cast plus adventure entries", () => {
    const legacy = {
      characters: [
        { ...defaultPC(), lastSpokeTurn: 4 },
        { ...newCharacter("m-navi"), name: "Navi", inParty: true, lastSpokeTurn: 7 },
        { ...newCharacter("m-bel"), name: "Bel", inParty: false, lastSpokeTurn: 0 },
      ],
    };
    const { game, legacyCast } = loadGame(legacy)!;

    // Ids are preserved, so every existing portrait blob keeps resolving.
    expect(game.characters.map((c) => c.id)).toEqual(["pc", "m-navi", "m-bel"]);
    // Party state moved off the character and onto the adventure.
    for (const c of game.characters) {
      expect(c).not.toHaveProperty("inParty");
      expect(c).not.toHaveProperty("lastSpokeTurn");
    }
    expect(game.roster).toEqual([
      { id: "pc", standing: "none", lastSpokeTurn: 4 },
      { id: "m-navi", standing: "active", lastSpokeTurn: 7 },
      { id: "m-bel", standing: "none", lastSpokeTurn: 0 },
    ]);
    // It carried its own cast, so there is nothing for the caller to supply.
    expect(legacyCast).toBe(false);
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
    const { game } = loadGame(saved)!;
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
    const c = loadGame(legacy)!.game.characters[0];
    expect(c.strengths).toBe("Superhuman Strength — lifts anything");
    expect(c).not.toHaveProperty("fieldSkill");
    expect(c).not.toHaveProperty("likes");
    expect(c).not.toHaveProperty("dislikes");
  });

  it("gives a character with neither field a blank strengths", () => {
    const legacy = { characters: [{ ...defaultPC(), strengths: undefined }] };
    expect(loadGame(legacy)!.game.characters[0].strengths).toBe("");
  });

  it("loads a character written before sex existed with a blank sex", () => {
    const legacy = { characters: [{ ...defaultPC(), sex: undefined }] };
    expect(loadGame(legacy)!.game.characters[0].sex).toBe("");
  });

  it("keeps a stored sex", () => {
    const legacy = { characters: [{ ...defaultPC(), sex: "female" }] };
    expect(loadGame(legacy)!.game.characters[0].sex).toBe("female");
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
    const c = loadGame(legacy)!.game.characters[0];
    expect(c.strengths).toBe("Lockpicking — opens anything");
    expect(c.flaws).toBe("");
  });

  it("keeps an existing Gold row (and its quantity) on migrate", () => {
    const current = newGame();
    current.inventory = [{ label: "Gold", description: "Currency", quantity: 77 }];
    const { game } = loadGame(current)!;
    expect(game.inventory).toHaveLength(1);
    expect(game.inventory[0].quantity).toBe(77);
  });
});

describe("seedAdventure — what a New Adventure carries over", () => {
  const imports = (patch: Partial<AdventureImports> = {}): AdventureImports => ({
    ...DEFAULT_ADVENTURE_IMPORTS,
    ...patch,
  });

  /** A played adventure: authored scenario, a cast, an NPC, notes, progress. */
  const played = (): GameState => {
    const pc = { ...defaultPC(), name: "Rell" };
    const game = newGame({ ...DEFAULT_SCENARIO, title: "My World" }, [
      pc,
      { ...newCharacter("m-navi"), name: "Navi" },
      { ...newCharacter("m-ida"), name: "Ida" },
    ]);
    return {
      ...game,
      roster: [
        { id: "m-navi", standing: "active", lastSpokeTurn: 7 },
        { id: "m-ida", standing: "npc", lastSpokeTurn: 2 },
      ],
      worldNotes: [{ id: "n1", title: "The Guild", keywords: ["guild"], content: "…" }],
      turnNumber: 12,
      messages: [{ id: "x", role: "narrator", content: "…", turn: 12 }],
    };
  };

  it("keeps everything ticked", () => {
    const next = seedAdventure(played(), imports({ characters: true, worldNotes: true }));
    expect(next.scenario.title).toBe("My World");
    expect(next.characters.map((c) => c.name)).toEqual(["Rell", "Navi", "Ida"]);
    expect(next.worldNotes).toHaveLength(1);
  });

  it("keeps nothing when nothing is ticked", () => {
    const next = seedAdventure(
      played(),
      imports({ scenario: false, pc: false, characters: false, worldNotes: false }),
    );
    expect(next.scenario).toEqual(DEFAULT_SCENARIO);
    expect(next.characters).toEqual([defaultPC()]);
    expect(next.worldNotes).toEqual([]);
  });

  it("keeps the player character without the rest of the cast", () => {
    const next = seedAdventure(played(), imports({ pc: true, characters: false }));
    expect(next.characters.map((c) => c.name)).toEqual(["Rell"]);
  });

  it("keeps the cast with a fresh player character", () => {
    const next = seedAdventure(played(), imports({ pc: false, characters: true }));
    expect(next.characters.map((c) => c.role)).toEqual(["pc", "member", "member"]);
    expect(next.characters[0].name).toBe(defaultPC().name);
  });

  it("always starts alone, and carries NPC standing only with the cast", () => {
    const withCast = seedAdventure(played(), imports({ characters: true }));
    // The active companion is dropped to nothing; the NPC survives as an NPC.
    expect(withCast.roster).toEqual([{ id: "m-ida", standing: "npc", lastSpokeTurn: 0 }]);

    const without = seedAdventure(played(), imports({ characters: false }));
    expect(without.roster).toEqual([]);
  });

  it("always resets the story itself", () => {
    const next = seedAdventure(played(), imports({ characters: true, worldNotes: true }));
    expect(next.messages).toEqual([]);
    expect(next.turnNumber).toBe(0);
    expect(next.journal).toEqual([]);
    expect(next.quests).toEqual([]);
    expect(next.inventory).toEqual([goldItem()]);
  });

  it("survives a cast with no player character in it", () => {
    const g = { ...newGame(DEFAULT_SCENARIO, [newCharacter("m-1")]) };
    expect(seedAdventure(g, imports({ pc: true })).characters.map((c) => c.role)).toEqual([
      "pc",
    ]);
  });
});

describe("default settings", () => {
  it("ships no reference images, and both prompt templates", () => {
    const s = defaultSettings();
    expect(s.portraitRefImages).toEqual([]);
    expect(s.imageTemplates.map((t) => t.format)).toEqual(["prose", "tags"]);
    expect(s.imageTemplateId).toBe("prose");
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
