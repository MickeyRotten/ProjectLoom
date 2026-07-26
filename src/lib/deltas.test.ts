import { describe, it, expect } from "vitest";
import { applyDeltas, simplifyLocation } from "./deltas";
import { defaultPC, newGame } from "./defaults";
import { activeMembers, getEntry, partyMembers, resolve } from "./roster";
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
    sex: "",
    description: "",
    personality: "",
    drive: "",
    strengths: "",
    flaws: "",
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

  it("keeps only the innermost place when the narrator staples two together", () => {
    const scene = applyDeltas(game(), lib(), {
      location: "Boars Head Tavern - Damp Cellar",
    });
    expect(scene.location).toBe("Damp Cellar");
  });

  it("keeps the prior scene when the location is nothing but separators", () => {
    const g = game();
    g.location = "Old Well";
    expect(applyDeltas(g, lib(), { location: " - " }).location).toBe("Old Well");
  });
});

describe("simplifyLocation", () => {
  it("takes the last segment of every compound joiner", () => {
    expect(simplifyLocation("Boars Head Tavern - Damp Cellar")).toBe("Damp Cellar");
    expect(simplifyLocation("Rodstroke: Market Square")).toBe("Market Square");
    expect(simplifyLocation("Murkwood / Old Well")).toBe("Old Well");
    expect(simplifyLocation("Keep — Tower — Belfry")).toBe("Belfry");
  });

  it("leaves a plain name alone", () => {
    expect(simplifyLocation("Damp Cellar")).toBe("Damp Cellar");
    expect(simplifyLocation("  Murkwood Entrance  ")).toBe("Murkwood Entrance");
  });

  it("never splits a hyphenated or comma'd name", () => {
    // No surrounding whitespace: part of the name, not a joiner.
    expect(simplifyLocation("Half-Moon Inn")).toBe("Half-Moon Inn");
    // Commas nest the other way round — the tail is the WIDER place.
    expect(simplifyLocation("Rodstroke, Mesmeria")).toBe("Rodstroke, Mesmeria");
    // A time of day, not a joiner: the colon rule needs whitespace after it.
    expect(simplifyLocation("Clocktower 12:00")).toBe("Clocktower 12:00");
  });

  it("returns empty for input with no name in it", () => {
    expect(simplifyLocation("")).toBe("");
    expect(simplifyLocation(" — ")).toBe("");
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
          sex: "female",
          description: "a darting spark",
          personality: "Impatient, chirpy.",
          drive: "See every locked room in the world.",
          strengths: "Lockpicking — opens anything",
          flaws: "Cannot sit still.",
          equipment: [{ label: "Lockpicks", description: "a bent set, well used" }],
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
      sex: "female",
      personality: "Impatient, chirpy.",
      drive: "See every locked room in the world.",
      strengths: "Lockpicking — opens anything",
      flaws: "Cannot sit still.",
      equipment: [{ label: "Lockpicks", description: "a bent set, well used" }],
    });
    expect(getEntry(scene.roster, "m-navi").standing).toBe("active");
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

  it("ignores sheet fields on update — a created character is frozen", () => {
    const characters = lib(
      member("m-navi", "Navi", {
        personality: "Chirpy.",
        description: "a darting spark",
        sex: "female",
      }),
    );
    const g = { ...game(), roster: [{ id: "m-navi", standing: "active" as const, lastSpokeTurn: 0 }] };
    const scene = applyDeltas(g, characters, {
      party: [
        {
          op: "update",
          name: "navi",
          personality: "Subdued.",
          description: "gone grey",
          species: "wraith",
          sex: "male",
          drive: "Rest.",
          strengths: "Wailing — chills a room",
        },
      ],
    });
    // Neither the authored character nor this adventure's view of them moves.
    const navi = resolve(scene.characters[1], getEntry(scene.roster, "m-navi"));
    expect(navi).toMatchObject({
      personality: "Chirpy.",
      description: "a darting spark",
      species: "sprite",
      sex: "female",
    });
    expect(getEntry(scene.roster, "m-navi").overrides).toBeUndefined();
  });

  it("still moves standing on an update that also carries sheet fields", () => {
    const characters = lib(member("m-navi", "Navi", { personality: "Chirpy." }));
    const g = { ...game(), roster: [{ id: "m-navi", standing: "active" as const, lastSpokeTurn: 0 }] };
    const scene = applyDeltas(g, characters, {
      party: [{ op: "update", name: "navi", personality: "Subdued.", standing: "benched" }],
    });
    expect(getEntry(scene.roster, "m-navi").standing).toBe("benched");
    expect(scene.characters.find((c) => c.id === "m-navi")?.personality).toBe("Chirpy.");
  });

  it("drops equipment rows with no label, and non-array equipment", () => {
    const scene = applyDeltas(game(), lib(), {
      party: [
        {
          op: "add",
          name: "Navi",
          equipment: [
            { label: "Cloak", description: "moth-eaten" },
            { label: "  ", description: "nothing" },
            // A description the model forgot is blank, never undefined.
            { label: "Belt" } as never,
          ],
        },
        { op: "add", name: "Bram", equipment: "a sword" as never },
      ],
    });
    expect(scene.characters.find((c) => c.name === "Navi")?.equipment).toEqual([
      { label: "Cloak", description: "moth-eaten" },
      { label: "Belt", description: "" },
    ]);
    expect(scene.characters.find((c) => c.name === "Bram")?.equipment).toEqual([]);
  });

  it("folds a legacy { name, description } strengths object into one line", () => {
    const scene = applyDeltas(game(), lib(), {
      party: [
        {
          op: "add",
          name: "Navi",
          strengths: { name: "Lockpicking", description: "opens anything" },
        },
      ],
    });
    expect(scene.characters.find((c) => c.name === "Navi")?.strengths).toBe(
      "Lockpicking — opens anything",
    );
  });

  it("ignores sheet fields when re-adding a character who already exists", () => {
    const characters = lib(member("m-navi", "Navi", { description: "a darting spark" }));
    const scene = applyDeltas(game(), characters, {
      party: [
        {
          op: "add",
          name: "navi",
          description: "now nine feet tall",
          drive: "Conquest.",
          // Gear is the player's after creation — a re-add never re-kits them.
          equipment: [{ label: "Crown", description: "stolen" }],
        },
      ],
    });
    // Re-used, not re-authored: the library record is the same object.
    expect(scene.characters).toBe(characters);
    expect(getEntry(scene.roster, "m-navi").overrides).toBeUndefined();
    expect(getEntry(scene.roster, "m-navi").standing).toBe("active");
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

  it("stops them travelling on remove, keeps the character, and records why", () => {
    const characters = lib(member("m-navi", "Navi"));
    const g = { ...game(), roster: [{ id: "m-navi", standing: "active" as const, lastSpokeTurn: 2 }] };
    const scene = applyDeltas(g, characters, { party: [{ op: "remove", name: "Navi" }] });
    expect(scene.characters.find((c) => c.name === "Navi")).toBeDefined();
    expect(getEntry(scene.roster, "m-navi")).toMatchObject({
      standing: "departed",
      // Per-run history survives the departure.
      lastSpokeTurn: 2,
    });
  });

  it("honours an explicit standing on remove", () => {
    const characters = lib(member("m-navi", "Navi"));
    const g = { ...game(), roster: [{ id: "m-navi", standing: "active" as const, lastSpokeTurn: 0 }] };
    const scene = applyDeltas(g, characters, {
      party: [{ op: "remove", name: "Navi", standing: "fallen" }],
    });
    expect(getEntry(scene.roster, "m-navi").standing).toBe("fallen");
  });

  it("never re-recruits a fallen character", () => {
    const characters = lib(member("m-navi", "Navi"));
    const g = { ...game(), roster: [{ id: "m-navi", standing: "fallen" as const, lastSpokeTurn: 0 }] };
    const scene = applyDeltas(g, characters, {
      party: [{ op: "add", name: "Navi", description: "somehow back" }],
    });
    expect(getEntry(scene.roster, "m-navi").standing).toBe("fallen");
    expect(getEntry(scene.roster, "m-navi").overrides).toBeUndefined();
  });

  it("re-adds a departed character and clears their standing", () => {
    const characters = lib(member("m-navi", "Navi"));
    const g = { ...game(), roster: [{ id: "m-navi", standing: "departed" as const, lastSpokeTurn: 0 }] };
    const scene = applyDeltas(g, characters, { party: [{ op: "add", name: "Navi" }] });
    expect(getEntry(scene.roster, "m-navi").standing).toBe("active");
  });

  it("caps party adds at PARTY_LIMIT — the overflow joins BENCHED", () => {
    const scene = applyDeltas(game(), lib(), {
      party: [
        { op: "add", name: "Ada" },
        { op: "add", name: "Bel" },
        { op: "add", name: "Cid" },
        { op: "add", name: "Dee" },
      ],
    });
    // All four become characters; only three travel with the player, and the
    // fourth lands somewhere the player can actually see them.
    expect(scene.characters.filter((c) => c.role === "member")).toHaveLength(4);
    expect(activeMembers(scene.characters, scene.roster)).toHaveLength(3);
    expect(getEntry(scene.roster, "m-dee").standing).toBe("benched");
  });

  it("does not let an unresolvable entry hold a party slot", () => {
    // An entry restored by undo for a character deleted since counts for
    // nothing — the cap is measured against who actually travels with you.
    const g = {
      ...game(),
      roster: [{ id: "gone", standing: "active" as const, lastSpokeTurn: 0 }],
    };
    const scene = applyDeltas(g, lib(), {
      party: [
        { op: "add", name: "Ada" },
        { op: "add", name: "Bel" },
        { op: "add", name: "Cid" },
      ],
    });
    expect(activeMembers(scene.characters, scene.roster)).toHaveLength(3);
  });

  it("does not pull a benched character into a full party", () => {
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
    expect(getEntry(scene.roster, "m-dee").standing).toBe("benched");
  });

  it("adds an important NPC without spending a party slot", () => {
    const scene = applyDeltas(game(), lib(), {
      party: [
        { op: "add", name: "Mira", species: "human", description: "the blacksmith" },
      ],
    });
    expect(scene.characters.find((c) => c.name === "Mira")).toBeDefined();
    expect(getEntry(scene.roster, "m-mira").standing).toBe("active");

    const npc = applyDeltas(game(), lib(), {
      party: [{ op: "add", name: "Mira", standing: "npc", description: "the blacksmith" }],
    });
    expect(getEntry(npc.roster, "m-mira").standing).toBe("npc");
    expect(partyMembers(npc.characters, npc.roster)).toEqual([]);
  });

  it("benches and un-benches a member on update, without touching their sheet", () => {
    const characters = lib(member("m-navi", "Navi", { personality: "Chirpy." }));
    const g = {
      ...game(),
      roster: [{ id: "m-navi", standing: "active" as const, lastSpokeTurn: 3 }],
    };
    const benched = applyDeltas(g, characters, {
      party: [{ op: "update", name: "Navi", standing: "benched" }],
    });
    expect(getEntry(benched.roster, "m-navi")).toMatchObject({
      standing: "benched",
      lastSpokeTurn: 3,
    });
    expect(benched.characters).toBe(characters);

    const back = applyDeltas(
      { ...game(), roster: benched.roster },
      characters,
      { party: [{ op: "update", name: "Navi", standing: "active" }] },
    );
    expect(getEntry(back.roster, "m-navi").standing).toBe("active");
  });

  it("still reads the pre-standing `status` on remove", () => {
    // Reversal replays delta blocks recorded before the rename.
    const characters = lib(member("m-navi", "Navi"));
    const g = {
      ...game(),
      roster: [{ id: "m-navi", standing: "active" as const, lastSpokeTurn: 0 }],
    };
    const scene = applyDeltas(g, characters, {
      party: [{ op: "remove", name: "Navi", status: "fallen" }],
    });
    expect(getEntry(scene.roster, "m-navi").standing).toBe("fallen");
  });

  it("never lets a remove leave someone in a party seat", () => {
    const characters = lib(member("m-navi", "Navi"));
    const g = {
      ...game(),
      roster: [{ id: "m-navi", standing: "active" as const, lastSpokeTurn: 0 }],
    };
    // A standing the model has no business asking for on a remove falls back to
    // a plain departure rather than keeping them in the scene.
    const scene = applyDeltas(g, characters, {
      party: [{ op: "remove", name: "Navi", standing: "active" }],
    });
    expect(getEntry(scene.roster, "m-navi").standing).toBe("departed");
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

describe("applyDeltas — conditions", () => {
  it("marks the PC, who no party op can touch", () => {
    const scene = applyDeltas(game(), lib(), {
      conditions: [{ name: "Hiro", condition: "Left arm in a sling" }],
    });
    expect(getEntry(scene.roster, "pc").condition).toBe("Left arm in a sling");
  });

  it("matches by slugged name, like every other op", () => {
    const navi = member("m-navi", "Navi");
    const scene = applyDeltas(game(), lib(navi), {
      conditions: [{ name: "  navi  ", condition: "Winded" }],
    });
    expect(getEntry(scene.roster, "m-navi").condition).toBe("Winded");
  });

  it("clears a mark on a blank condition, leaving no stored key", () => {
    let scene = applyDeltas(game(), lib(), {
      conditions: [{ name: "Hiro", condition: "Bleeding" }],
    });
    const g = { ...game(), roster: scene.roster };
    scene = applyDeltas(g, lib(), { conditions: [{ name: "Hiro", condition: "" }] });
    expect(getEntry(scene.roster, "pc").condition).toBeUndefined();
  });

  it("ignores a name nothing resolves — conditions never create anyone", () => {
    const scene = applyDeltas(game(), lib(), {
      conditions: [{ name: "Nobody", condition: "Cursed" }],
    });
    expect(scene.roster).toHaveLength(0);
    expect(scene.characters).toHaveLength(1);
  });

  it("can mark a companion the same block just created", () => {
    const scene = applyDeltas(game(), lib(), {
      party: [{ op: "add", name: "Riley" }],
      conditions: [{ name: "Riley", condition: "Twisted ankle" }],
    });
    const riley = activeMembers(scene.characters, scene.roster)[0];
    expect(riley.name).toBe("Riley");
    expect(riley.condition).toBe("Twisted ankle");
  });

  it("returns the same roster reference when nothing changed", () => {
    const g = game();
    const scene = applyDeltas(g, lib(), {
      conditions: [{ name: "Hiro", condition: "" }],
    });
    // Reversal reference-diffs the roster: a no-op must not look like a change.
    expect(scene.roster).toBe(g.roster);
  });
});

describe("applyDeltas — world notes", () => {
  it("writes a new note with keywords", () => {
    const scene = applyDeltas(game(), lib(), {
      notes: [{ op: "add", title: "Rodstroke", content: "A farming village.", keywords: ["village"] }],
    });
    expect(scene.worldNotes).toHaveLength(1);
    expect(scene.worldNotes[0].title).toBe("Rodstroke");
    expect(scene.worldNotes[0].content).toBe("A farming village.");
    expect(scene.worldNotes[0].keywords).toEqual(["village"]);
  });

  it("treats an add on a known title as an update — the world learns more", () => {
    const g = game();
    g.worldNotes = [{ id: "n1", title: "Rodstroke", keywords: ["village"], content: "A village." }];
    const scene = applyDeltas(g, lib(), {
      notes: [{ op: "add", title: "rodstroke", content: "A village under curfew." }],
    });
    expect(scene.worldNotes).toHaveLength(1);
    expect(scene.worldNotes[0].content).toBe("A village under curfew.");
  });

  it("merges keywords instead of replacing the player's", () => {
    const g = game();
    g.worldNotes = [{ id: "n1", title: "Rodstroke", keywords: ["village", "Mira"], content: "" }];
    const scene = applyDeltas(g, lib(), {
      notes: [{ op: "update", title: "Rodstroke", keywords: ["MIRA", "curfew"] }],
    });
    expect(scene.worldNotes[0].keywords).toEqual(["village", "Mira", "curfew"]);
  });

  it("never sets permanent — an always-on note is the player's call", () => {
    const scene = applyDeltas(game(), lib(), {
      notes: [{ op: "add", title: "Rodstroke", content: "x", permanent: true } as never],
    });
    expect(scene.worldNotes[0].permanent).toBeUndefined();
  });

  it("removes a note by title", () => {
    const g = game();
    g.worldNotes = [{ id: "n1", title: "Rodstroke", keywords: [], content: "" }];
    const scene = applyDeltas(g, lib(), { notes: [{ op: "remove", title: "Rodstroke" }] });
    expect(scene.worldNotes).toHaveLength(0);
  });

  it("skips titleless rows and returns the same array when nothing applied", () => {
    const g = game();
    const scene = applyDeltas(g, lib(), { notes: [{ op: "add", title: "" }] });
    expect(scene.worldNotes).toBe(g.worldNotes);
  });
});
