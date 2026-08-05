import { describe, expect, it } from "vitest";
import { captureReversal, applyReversal } from "./reversal";
import { applyDeltas } from "./deltas";
import { defaultPC, newGame } from "./defaults";
import { getEntry, mergeOverrides, partyMembers } from "./roster";
import type { Character, GameState, LoomBlock, Reversal } from "../types";

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

/* ------------------------------------------------------------------ *
 * Foresight (DESIGN.md → Foresight → Reversal)
 * ------------------------------------------------------------------ */

describe("reversal — foresight", () => {
  const arc = {
    id: "arc-1",
    question: "q",
    front: { label: "the mine floods", steps: ["a", "b"], ticks: 0, lastTickDay: 1, status: "open" as const },
    epoch: 0,
    status: "running" as const,
    areas: [],
    openedTurn: 0,
  };

  const pre = (): GameState => ({
    ...seed(),
    arcs: [arc],
    promises: [],
    areaKey: "murkwood",
    areas: { murkwood: { key: "murkwood", name: "Murkwood", arcId: "arc-1", epoch: 0, version: 1, coord: { x: 0, y: 0 }, neighbours: [], texture: "", threats: [], rooms: {} } },
  });

  it("captures the ticks, the promises and the area pointer", () => {
    const before = pre();
    const after: GameState = {
      ...before,
      arcs: [{ ...arc, front: { ...arc.front, ticks: 1 } }],
      promises: [{ id: "p1", text: "the tremor", plantedTurn: 4 }],
      areaKey: "rodstroke",
    };
    const rev = captureReversal(before, after);
    expect(rev.arcs?.[0].front?.ticks).toBe(0);
    expect(rev.promises).toEqual([]);
    expect(rev.areaKey).toBe("murkwood");

    const back = applyReversal(after, rev);
    expect(back.arcs?.[0].front?.ticks).toBe(0);
    expect(back.promises).toEqual([]);
    expect(back.areaKey).toBe("murkwood");
  });

  it("never captures the gazetteer — prep is a cache, not state", () => {
    const before = pre();
    const after: GameState = { ...before, areas: { ...before.areas, elsewhere: before.areas!.murkwood } };
    expect(captureReversal(before, after)).not.toHaveProperty("areas");
    // …so undo leaves the player in a room whose card is still cached: no
    // re-prep, no double tick, and a small snapshot.
    expect(applyReversal(after, captureReversal(before, after)).areas).toBe(after.areas);
  });

  it("records nothing on a turn that touched none of it", () => {
    const before = pre();
    const rev = captureReversal(before, { ...before });
    expect(rev).not.toHaveProperty("arcs");
    expect(rev).not.toHaveProperty("promises");
    expect(rev).not.toHaveProperty("areaKey");
  });

  it("restores an area pointer that was genuinely null before the turn", () => {
    const before: GameState = { ...pre(), areaKey: null };
    const after: GameState = { ...before, areaKey: "murkwood" };
    const rev = captureReversal(before, after);
    expect(rev.areaKey).toBeNull();
    expect(applyReversal(after, rev).areaKey).toBeNull();
  });

  it("leaves a pre-foresight snapshot alone rather than blanking the slices", () => {
    const game = pre();
    const legacy: Reversal = { day: 1, location: "x", weather: "clear" };
    const back = applyReversal(game, legacy);
    expect(back.arcs).toBe(game.arcs);
    expect(back.promises).toBe(game.promises);
    expect(back.areaKey).toBe("murkwood");
  });
});
