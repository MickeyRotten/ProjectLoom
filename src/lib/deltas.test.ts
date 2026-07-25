import { describe, it, expect } from "vitest";
import { applyDeltas } from "./deltas";
import { defaultPC, newGame } from "./defaults";
import { getEntry, partyMembers, resolve } from "./roster";
import type { Character, GameState } from "../types";

function game(): GameState {
  return newGame();
}

/** The global character library: just the PC unless a test adds more. */
function lib(...extra: Character[]): Character[] {
  return [defaultPC(), ...extra];
}

function member(id: string, name: string, patch: Partial<Character> = {}): Character {
  return {
    id,
    role: "member",
    name,
    species: "sprite",
    description: "",
    personality: "",
    drive: "",
    strengths: { name: "", description: "" },
    equipment: [],
    ...patch,
  };
}

describe("applyDeltas — scene", () => {
  it("overwrites location/day/weather when present", () => {
    const scene = applyDeltas(game(), lib(), {
      location: "The Ruins",
      day: 40,
      weather: "dust",
    });
    expect(scene.location).toBe("The Ruins");
    expect(scene.day).toBe(40);
    expect(scene.weather).toBe("dust");
  });

  it("keeps prior scene values when a field is absent", () => {
    const g = game();
    g.location = "Old Well";
    g.day = 5;
    g.weather = "clear";
    const scene = applyDeltas(g, lib(), { day: 6 });
    expect(scene.location).toBe("Old Well");
    expect(scene.day).toBe(6);
    expect(scene.weather).toBe("clear");
  });
});

describe("applyDeltas — inventory ops", () => {
  it("adds a new item", () => {
    const g = game();
    g.inventory = [];
    const scene = applyDeltas(g, lib(), {
      inventory: [{ op: "add", label: "Cracked Compass", description: "spins wrong", quantity: 1 }],
    });
    expect(scene.inventory).toHaveLength(1);
    expect(scene.inventory[0]).toMatchObject({ label: "Cracked Compass", quantity: 1 });
  });

  it("merges quantity when adding an existing item", () => {
    const g = game();
    g.inventory = [{ label: "Ration", description: "dry", quantity: 2 }];
    const scene = applyDeltas(g, lib(), {
      inventory: [{ op: "add", label: "ration", quantity: 3 }],
    });
    expect(scene.inventory).toHaveLength(1);
    expect(scene.inventory[0].quantity).toBe(5);
  });

  it("updates fields without touching quantity when omitted", () => {
    const g = game();
    g.inventory = [{ label: "Knife", description: "dull", quantity: 1 }];
    const scene = applyDeltas(g, lib(), {
      inventory: [{ op: "update", label: "Knife", description: "sharp" }],
    });
    expect(scene.inventory[0]).toMatchObject({ description: "sharp", quantity: 1 });
  });

  it("removes an item", () => {
    const g = game();
    g.inventory = [{ label: "Torch", description: "", quantity: 1 }];
    const scene = applyDeltas(g, lib(), { inventory: [{ op: "remove", label: "Torch" }] });
    expect(scene.inventory).toHaveLength(0);
  });

  it("zeroes Gold on remove instead of deleting it (permanent currency)", () => {
    const g = game();
    g.inventory = [{ label: "Gold", description: "Currency", quantity: 50 }];
    const scene = applyDeltas(g, lib(), { inventory: [{ op: "remove", label: "gold" }] });
    expect(scene.inventory).toHaveLength(1);
    expect(scene.inventory[0]).toMatchObject({ label: "Gold", quantity: 0 });
  });

  it("updates the Gold total via the update op", () => {
    const g = game();
    g.inventory = [{ label: "Gold", description: "Currency", quantity: 10 }];
    const scene = applyDeltas(g, lib(), {
      inventory: [{ op: "update", label: "Gold", quantity: 120 }],
    });
    expect(scene.inventory[0].quantity).toBe(120);
  });

  it("leaves inventory untouched when no inventory deltas", () => {
    const g = game();
    g.inventory = [{ label: "Rope", description: "", quantity: 1 }];
    const scene = applyDeltas(g, lib(), { day: 2 });
    expect(scene.inventory).toBe(g.inventory);
  });
});

describe("applyDeltas — party ops", () => {
  it("writes a brand-new character into the library and the party", () => {
    const scene = applyDeltas(game(), lib(), {
      party: [
        {
          op: "add",
          name: "Navi",
          species: "sprite",
          description: "a darting spark",
          personality: "Impatient, chirpy.",
          drive: "See every locked room in the world.",
          strengths: { name: "Lockpicking", description: "opens anything" },
        },
      ],
    });
    const navi = scene.characters.find((c) => c.name === "Navi");
    // A character with no base yet has nothing to diverge from, so the
    // narrator's fields land on the character itself.
    expect(navi).toMatchObject({
      id: "m-navi",
      role: "member",
      species: "sprite",
      personality: "Impatient, chirpy.",
      drive: "See every locked room in the world.",
      strengths: { name: "Lockpicking", description: "opens anything" },
    });
    expect(getEntry(scene.roster, "m-navi").inParty).toBe(true);
    expect(getEntry(scene.roster, "m-navi").overrides).toBeUndefined();
  });

  it("re-uses a character from an earlier adventure instead of duplicating", () => {
    // Navi exists in the library but is in no party — a fresh adventure.
    const characters = lib(member("m-navi", "Navi", { description: "a darting spark" }));
    const scene = applyDeltas(game(), characters, {
      party: [{ op: "add", name: "navi" }],
    });
    expect(scene.characters.filter((c) => c.role === "member")).toHaveLength(1);
    // Same record, so the portrait keyed on this id comes back with them.
    expect(scene.characters).toBe(characters);
    expect(partyMembers(scene.characters, scene.roster).map((m) => m.id)).toEqual(["m-navi"]);
  });

  it("writes story field changes as overrides, never onto the character", () => {
    const characters = lib(member("m-navi", "Navi", { personality: "Chirpy." }));
    const g = { ...game(), roster: [{ id: "m-navi", inParty: true, lastSpokeTurn: 0, status: "active" as const }] };
    const scene = applyDeltas(g, characters, {
      party: [{ op: "update", name: "navi", personality: "Subdued." }],
    });
    // The authored character is untouched...
    expect(scene.characters.find((c) => c.id === "m-navi")?.personality).toBe("Chirpy.");
    // ...but this adventure sees the rewritten value.
    const navi = resolve(scene.characters[1], getEntry(scene.roster, "m-navi"));
    expect(navi.personality).toBe("Subdued.");
    // An omitted field is not overridden at all.
    expect(getEntry(scene.roster, "m-navi").overrides).toEqual({ personality: "Subdued." });
  });

  it("never touches the PC", () => {
    const characters = lib();
    const scene = applyDeltas(game(), characters, {
      party: [{ op: "update", name: "Hiro", description: "changed" }],
    });
    expect(scene.characters.find((c) => c.role === "pc")?.description).toBe(
      characters[0].description,
    );
    expect(scene.roster).toHaveLength(0);
  });

  it("update never creates a character", () => {
    const scene = applyDeltas(game(), lib(), {
      party: [{ op: "update", name: "Nobody", description: "x" }],
    });
    expect(scene.characters.filter((c) => c.role === "member")).toHaveLength(0);
  });

  it("un-parties on remove, keeps the character, and records why", () => {
    const characters = lib(member("m-navi", "Navi"));
    const g = { ...game(), roster: [{ id: "m-navi", inParty: true, lastSpokeTurn: 2, status: "active" as const }] };
    const scene = applyDeltas(g, characters, { party: [{ op: "remove", name: "Navi" }] });
    expect(scene.characters.find((c) => c.name === "Navi")).toBeDefined();
    expect(getEntry(scene.roster, "m-navi")).toMatchObject({
      inParty: false,
      status: "departed",
      // Per-run history survives the departure.
      lastSpokeTurn: 2,
    });
  });

  it("honours an explicit status on remove", () => {
    const characters = lib(member("m-navi", "Navi"));
    const g = { ...game(), roster: [{ id: "m-navi", inParty: true, lastSpokeTurn: 0, status: "active" as const }] };
    const scene = applyDeltas(g, characters, {
      party: [{ op: "remove", name: "Navi", status: "fallen" }],
    });
    expect(getEntry(scene.roster, "m-navi").status).toBe("fallen");
  });

  it("never re-recruits a fallen character", () => {
    const characters = lib(member("m-navi", "Navi"));
    const g = { ...game(), roster: [{ id: "m-navi", inParty: false, lastSpokeTurn: 0, status: "fallen" as const }] };
    const scene = applyDeltas(g, characters, {
      party: [{ op: "add", name: "Navi", description: "somehow back" }],
    });
    expect(getEntry(scene.roster, "m-navi")).toMatchObject({ inParty: false, status: "fallen" });
    expect(getEntry(scene.roster, "m-navi").overrides).toBeUndefined();
  });

  it("re-adds a departed character and clears their standing", () => {
    const characters = lib(member("m-navi", "Navi"));
    const g = { ...game(), roster: [{ id: "m-navi", inParty: false, lastSpokeTurn: 0, status: "departed" as const }] };
    const scene = applyDeltas(g, characters, { party: [{ op: "add", name: "Navi" }] });
    expect(getEntry(scene.roster, "m-navi")).toMatchObject({ inParty: true, status: "active" });
  });

  it("caps party adds at PARTY_LIMIT — the overflow joins out of the party", () => {
    const scene = applyDeltas(game(), lib(), {
      party: [
        { op: "add", name: "Ada" },
        { op: "add", name: "Bel" },
        { op: "add", name: "Cid" },
        { op: "add", name: "Dee" },
      ],
    });
    // All four become characters; only three travel with the player.
    expect(scene.characters.filter((c) => c.role === "member")).toHaveLength(4);
    expect(partyMembers(scene.characters, scene.roster)).toHaveLength(3);
    expect(getEntry(scene.roster, "m-dee").inParty).toBe(false);
  });

  it("does not add a waiting character when the party is full", () => {
    const first = applyDeltas(game(), lib(), {
      party: [
        { op: "add", name: "Ada" },
        { op: "add", name: "Bel" },
        { op: "add", name: "Cid" },
        { op: "add", name: "Dee" },
      ],
    });
    const g = { ...game(), roster: first.roster };
    const scene = applyDeltas(g, first.characters, { party: [{ op: "add", name: "Dee" }] });
    expect(getEntry(scene.roster, "m-dee").inParty).toBe(false);
  });

  it("keeps a name-derived id unique so portraits never collide", () => {
    // An old "Navi" was renamed in the sheet but kept the id it was born with.
    const characters = lib(member("m-navi", "Renamed"));
    const scene = applyDeltas(game(), characters, { party: [{ op: "add", name: "Navi" }] });
    const ids = scene.characters.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("m-navi-2");
  });

  it("leaves both halves untouched with no party deltas", () => {
    const g = game();
    const characters = lib();
    const scene = applyDeltas(g, characters, { day: 2 });
    expect(scene.characters).toBe(characters);
    expect(scene.roster).toBe(g.roster);
  });
});

describe("applyDeltas — quest ops", () => {
  it("adds an active quest with reward", () => {
    const scene = applyDeltas(game(), lib(), {
      quests: [{ op: "add", label: "Reach the Settlement", description: "go north", reward: "water" }],
    });
    expect(scene.quests).toHaveLength(1);
    expect(scene.quests[0]).toMatchObject({
      label: "Reach the Settlement",
      reward: "water",
      status: "active",
    });
  });

  it("marks a quest done via update", () => {
    const g = game();
    g.quests = [{ id: "q1", label: "Find Water", description: "", reward: "", status: "active" }];
    const scene = applyDeltas(g, lib(), {
      quests: [{ op: "update", label: "Find Water", status: "done" }],
    });
    expect(scene.quests[0].status).toBe("done");
  });

  it("does not duplicate an existing quest on add", () => {
    const g = game();
    g.quests = [{ id: "q1", label: "Find Water", description: "", reward: "", status: "active" }];
    const scene = applyDeltas(g, lib(), { quests: [{ op: "add", label: "find water" }] });
    expect(scene.quests).toHaveLength(1);
  });
});
