import { describe, expect, it } from "vitest";
import { captureReversal, applyReversal } from "./reversal";
import { applyDeltas } from "./deltas";
import { newGame } from "./defaults";
import type { GameState, LoomBlock } from "../types";

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
function turn(pre: GameState, block: LoomBlock): GameState {
  const scene = applyDeltas(pre, block);
  return {
    ...pre,
    characters: scene.characters,
    inventory: scene.inventory,
    quests: scene.quests,
    day: scene.day,
    location: scene.location,
    weather: scene.weather,
  };
}

describe("captureReversal", () => {
  it("always captures the scene scalars", () => {
    const pre = seed();
    const rev = captureReversal(pre, pre);
    expect(rev).toMatchObject({ day: 3, location: "The Dusty Path", weather: "windy" });
  });

  it("omits unchanged slices (a plain narration turn stores only scalars)", () => {
    const pre = seed();
    const post = turn(pre, { location: "The Ridge", weather: "clear", day: 4 });
    const rev = captureReversal(pre, post);
    expect(rev.characters).toBeUndefined();
    expect(rev.inventory).toBeUndefined();
    expect(rev.quests).toBeUndefined();
  });

  it("captures a slice only when the turn changed it", () => {
    const pre = seed();
    const post = turn(pre, { inventory: [{ op: "add", label: "Rope", quantity: 1 }] });
    const rev = captureReversal(pre, post);
    expect(rev.inventory).toBe(pre.inventory);
    expect(rev.characters).toBeUndefined();
    expect(rev.quests).toBeUndefined();
  });
});

describe("applyReversal round-trips", () => {
  it("restores scalars overwritten by the turn", () => {
    const pre = seed();
    const post = turn(pre, { location: "The Ridge", weather: "clear", day: 9 });
    const rev = captureReversal(pre, post);
    const back = applyReversal(post, rev);
    expect(back.location).toBe("The Dusty Path");
    expect(back.weather).toBe("windy");
    expect(back.day).toBe(3);
  });

  it("restores an item lost to a remove (lossy op, exact undo)", () => {
    const pre = seed();
    const post = turn(pre, { inventory: [{ op: "remove", label: "Canteen" }] });
    expect(post.inventory).toHaveLength(0);
    const back = applyReversal(post, captureReversal(pre, post));
    expect(back.inventory).toEqual(pre.inventory);
  });

  it("restores a benched member added by the turn", () => {
    const pre = seed();
    const post = turn(pre, {
      party: [{ op: "add", name: "Riley", species: "human", description: "scout" }],
    });
    expect(post.characters.some((c) => c.name === "Riley")).toBe(true);
    const back = applyReversal(post, captureReversal(pre, post));
    expect(back.characters).toEqual(pre.characters);
    expect(back.characters.some((c) => c.name === "Riley")).toBe(false);
  });

  it("leaves untouched slices referentially identical", () => {
    const pre = seed();
    const post = turn(pre, { quests: [{ op: "add", label: "Find shade" }] });
    const back = applyReversal(post, captureReversal(pre, post));
    // Inventory/characters were never touched, so undo keeps the live refs.
    expect(back.inventory).toBe(post.inventory);
    expect(back.characters).toBe(post.characters);
    expect(back.quests).toEqual(pre.quests);
  });
});
