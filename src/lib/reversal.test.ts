import { describe, expect, it } from "vitest";
import { captureReversal, applyReversal } from "./reversal";
import { applyDeltas } from "./deltas";
import { defaultPC, newGame } from "./defaults";
import { getEntry, mergeOverrides, partyMembers } from "./roster";
import type { Character, GameState, LoomBlock, Place, Reversal } from "../types";

/** A companion in the library, with nothing this adventure has changed. */
function navi(): Character {
  return {
    id: "m-navi",
    role: "member",
    name: "Navi",
    species: "sprite",
    sex: "",
    description: "a darting spark",
    personality: "",
    drive: "",
    strengths: "",
    flaws: "",
    notes: "",
    equipment: [],
  };
}

/** A pre-turn game with a known scene + one item + one quest. */
function seed(): GameState {
  const g = newGame();
  return {
    ...g,
    day: 3,
    location: "The Dusty Path",
    weather: "windy",
    inventory: [{ label: "Canteen", description: "half full", quantity: 1 }],
    quests: [{ id: "q1", label: "Reach the well", description: "", reward: "", status: "active" }],
  };
}

/** Mirror the store: apply a block, fold the changed slices into a post game. */
function turn(
  pre: GameState,
  characters: Character[],
  block: LoomBlock,
): { game: GameState; characters: Character[] } {
  const scene = applyDeltas(pre, characters, block);
  return {
    game: {
      ...pre,
      roster: scene.roster,
      inventory: scene.inventory,
      quests: scene.quests,
      day: scene.day,
      minutes: scene.minutes,
      location: scene.location,
      weather: scene.weather,
    },
    characters: scene.characters,
  };
}

describe("captureReversal", () => {
  it("always captures the scene scalars", () => {
    const pre = seed();
    const rev = captureReversal(pre, pre);
    expect(rev).toMatchObject({ day: 3, location: "The Dusty Path", weather: "windy" });
  });

  it("captures the clock, so undo puts the time of day back too", () => {
    const pre = { ...seed(), minutes: 9 * 60 };
    const { game: post } = turn(pre, [defaultPC()], { duration: "hours" });
    const rev = captureReversal(pre, post);
    expect(post.minutes).toBe(13 * 60);
    expect(rev.minutes).toBe(9 * 60);
    expect(applyReversal(post, rev).minutes).toBe(9 * 60);
  });

  it("captures the journal only on a turn that opened an entry", () => {
    const pre = seed();
    expect(captureReversal(pre, { ...pre })).not.toHaveProperty("journal");

    const post = {
      ...pre,
      journal: [{ id: "j-1", day: 3, fromTurn: 1, throughTurn: 8, lines: [] }],
    };
    const rev = captureReversal(pre, post);
    expect(rev.journal).toEqual([]);
    // Undoing the turn that opened the entry takes the entry with it — which is
    // why the entry is created synchronously, before this snapshot is taken.
    expect(applyReversal(post, rev).journal).toEqual([]);
  });

  it("omits unchanged slices (a plain narration turn stores only scalars)", () => {
    const pre = seed();
    const { game: post } = turn(pre, [defaultPC()], {
      location: "The Ridge",
      weather: "clear",
      day: 4,
    });
    const rev = captureReversal(pre, post);
    expect(rev.roster).toBeUndefined();
    expect(rev.inventory).toBeUndefined();
    expect(rev.quests).toBeUndefined();
  });

  it("captures a slice only when the turn changed it", () => {
    const pre = seed();
    const { game: post } = turn(pre, [defaultPC()], {
      inventory: [{ op: "add", label: "Rope", quantity: 1 }],
    });
    const rev = captureReversal(pre, post);
    expect(rev.inventory).toBe(pre.inventory);
    expect(rev.roster).toBeUndefined();
    expect(rev.quests).toBeUndefined();
  });

  it("never captures the cast", () => {
    const pre = seed();
    const { game: post } = turn(pre, [defaultPC()], {
      party: [{ op: "add", name: "Riley" }],
    });
    const rev = captureReversal(pre, post);
    expect(rev.roster).toBe(pre.roster);
    expect(rev.characters).toBeUndefined();
  });
});

describe("applyReversal round-trips", () => {
  it("restores scalars overwritten by the turn", () => {
    const pre = seed();
    const { game: post } = turn(pre, [defaultPC()], {
      location: "The Ridge",
      weather: "clear",
      day: 9,
    });
    const back = applyReversal(post, captureReversal(pre, post));
    expect(back.location).toBe("The Dusty Path");
    expect(back.weather).toBe("windy");
    expect(back.day).toBe(3);
  });

  it("restores an item lost to a remove (lossy op, exact undo)", () => {
    const pre = seed();
    const { game: post } = turn(pre, [defaultPC()], {
      inventory: [{ op: "remove", label: "Canteen" }],
    });
    expect(post.inventory).toHaveLength(0);
    const back = applyReversal(post, captureReversal(pre, post));
    expect(back.inventory).toEqual(pre.inventory);
  });

  it("un-parties someone the turn recruited, but leaves them in Characters", () => {
    const pre = seed();
    const { game: post, characters } = turn(pre, [defaultPC()], {
      party: [{ op: "add", name: "Riley", species: "human", description: "scout" }],
    });
    expect(partyMembers(characters, post.roster).map((m) => m.name)).toEqual(["Riley"]);

    const back = applyReversal(post, captureReversal(pre, post));
    expect(back.roster).toEqual(pre.roster);
    expect(partyMembers(characters, back.roster)).toEqual([]);
    // Undo never destroys a character — only the player deletes.
    expect(characters.some((c) => c.name === "Riley")).toBe(true);
  });

  it("puts a benched member back in the scene", () => {
    const characters = [defaultPC(), navi()];
    const pre = {
      ...seed(),
      roster: [{ id: "m-navi", standing: "active" as const, lastSpokeTurn: 0 }],
    };
    const { game: post } = turn(pre, characters, {
      party: [{ op: "update", name: "Navi", standing: "benched" }],
    });
    expect(getEntry(post.roster, "m-navi").standing).toBe("benched");

    const back = applyReversal(post, captureReversal(pre, post));
    expect(getEntry(back.roster, "m-navi").standing).toBe("active");
  });

  it("normalizes a snapshot written before the standing ladder", () => {
    // Reversals live inside saved messages, so the old shape keeps arriving.
    const legacy: Reversal = {
      day: 3,
      location: "The Dusty Path",
      weather: "windy",
      roster: [
        { id: "m-navi", inParty: true, lastSpokeTurn: 5, status: "active" },
      ] as unknown as Reversal["roster"],
    };
    const back = applyReversal({ ...seed(), roster: [] }, legacy);
    expect(back.roster).toEqual([{ id: "m-navi", standing: "active", lastSpokeTurn: 5 }]);
  });

  it("restores overrides written during the turn window", () => {
    // Party deltas no longer write overrides (a created sheet is frozen), but
    // Auto-Update still does — and an undo must roll one back with the rest of
    // the roster rather than strand it on a turn that no longer exists.
    const pre = {
      ...seed(),
      roster: [{ id: "m-navi", standing: "active" as const, lastSpokeTurn: 0 }],
    };
    const post = {
      ...pre,
      roster: mergeOverrides(pre.roster, "m-navi", { description: "singed" }),
    };
    expect(getEntry(post.roster, "m-navi").overrides).toEqual({ description: "singed" });

    const back = applyReversal(post, captureReversal(pre, post));
    expect(getEntry(back.roster, "m-navi").overrides).toBeUndefined();
  });

  it("leaves untouched slices referentially identical", () => {
    const pre = seed();
    const { game: post } = turn(pre, [defaultPC()], {
      quests: [{ op: "add", label: "Find shade" }],
    });
    const back = applyReversal(post, captureReversal(pre, post));
    // Inventory/roster were never touched, so undo keeps the live refs.
    expect(back.inventory).toBe(post.inventory);
    expect(back.roster).toBe(post.roster);
    expect(back.quests).toEqual(pre.quests);
  });

  it("still undoes turns recorded before the Characters/Party split", () => {
    // A pre-split reversal stored the whole character array.
    const legacy: Reversal = {
      day: 3,
      location: "The Dusty Path",
      weather: "windy",
      characters: [
        { ...defaultPC(), lastSpokeTurn: 0, inParty: false },
        {
          id: "m-navi",
          role: "member",
          name: "Navi",
          species: "sprite",
          description: "",
          personality: "",
          drive: "",
          strengths: "",
          flaws: "",
          equipment: [],
          inParty: true,
          lastSpokeTurn: 5,
        },
      ],
    };
    const back = applyReversal({ ...seed(), roster: [] }, legacy);
    expect(back.roster).toEqual([
      { id: "pc", standing: "none", lastSpokeTurn: 0 },
      { id: "m-navi", standing: "active", lastSpokeTurn: 5 },
    ]);
  });
});

describe("reversal — world notes", () => {
  it("snapshots the notes slice only when a turn wrote one", () => {
    const pre = seed();
    const written = applyDeltas(pre, [defaultPC()], {
      notes: [{ op: "add", title: "Rodstroke", content: "A village." }],
    });
    const post = { ...pre, worldNotes: written.worldNotes };
    expect(captureReversal(pre, post).worldNotes).toBe(pre.worldNotes);

    // A turn that wrote no note records no slice.
    const quiet = applyDeltas(pre, [defaultPC()], { location: "Elsewhere" });
    expect(
      captureReversal(pre, { ...pre, worldNotes: quiet.worldNotes }).worldNotes,
    ).toBeUndefined();
  });

  it("undo drops a note the narrator wrote", () => {
    const pre = seed();
    const written = applyDeltas(pre, [defaultPC()], {
      notes: [{ op: "add", title: "Rodstroke", content: "A village." }],
    });
    const post = { ...pre, worldNotes: written.worldNotes };
    const rev = captureReversal(pre, post);
    expect(post.worldNotes).toHaveLength(1);
    expect(applyReversal(post, rev).worldNotes).toEqual(pre.worldNotes);
  });

  it("leaves notes alone on a reversal recorded before they existed", () => {
    const g = { ...seed(), worldNotes: [{ id: "n1", title: "Kept", keywords: [], content: "" }] };
    const legacy: Reversal = { day: 1, location: "x", weather: "clear" };
    expect(applyReversal(g, legacy).worldNotes).toBe(g.worldNotes);
  });
});

describe("reversal — places", () => {
  const stub: Place = {
    id: "p9",
    name: "Rodstroke",
    description: "",
    keywords: [],
    pending: true,
  };

  it("captures the area and the places a turn discovered", () => {
    const pre = { ...newGame(), area: "Murkwood" };
    const post = { ...pre, area: "Rodstroke", places: [stub] };
    const rev = captureReversal(pre, post);
    expect(rev.area).toBe("Murkwood");
    expect(rev.places).toEqual([]);
  });

  it("captures no places on a turn that discovered nowhere", () => {
    const pre = { ...newGame(), area: "Murkwood" };
    expect(captureReversal(pre, { ...pre, day: 2 }).places).toBeUndefined();
  });

  it("restores both, so undo un-discovers the place with the turn", () => {
    const pre = { ...newGame(), area: "Murkwood" };
    const post = { ...pre, area: "Rodstroke", places: [stub] };
    const back = applyReversal(post, captureReversal(pre, post));
    expect(back.area).toBe("Murkwood");
    expect(back.places).toEqual([]);
  });

  it("leaves the area alone on a snapshot taken before areas existed", () => {
    const game = { ...newGame(), area: "Rodstroke" };
    expect(applyReversal(game, { day: 1, location: "Market Square", weather: "clear" }).area).toBe(
      "Rodstroke",
    );
  });
});
