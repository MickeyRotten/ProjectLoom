import { describe, it, expect } from "vitest";
import { applyDeltas } from "./deltas";
import { newGame } from "./defaults";
import type { GameState } from "../types";

function game(): GameState {
  return newGame();
}

describe("applyDeltas — scene", () => {
  it("overwrites location/day/weather when present", () => {
    const g = game();
    const scene = applyDeltas(g, { location: "The Ruins", day: 40, weather: "dust" });
    expect(scene.location).toBe("The Ruins");
    expect(scene.day).toBe(40);
    expect(scene.weather).toBe("dust");
  });

  it("keeps prior scene values when a field is absent", () => {
    const g = game();
    g.location = "Old Well";
    g.day = 5;
    g.weather = "clear";
    const scene = applyDeltas(g, { day: 6 });
    expect(scene.location).toBe("Old Well");
    expect(scene.day).toBe(6);
    expect(scene.weather).toBe("clear");
  });
});

describe("applyDeltas — inventory ops", () => {
  it("adds a new item", () => {
    const g = game();
    const scene = applyDeltas(g, {
      inventory: [{ op: "add", label: "Cracked Compass", description: "spins wrong", quantity: 1 }],
    });
    expect(scene.inventory).toHaveLength(1);
    expect(scene.inventory[0]).toMatchObject({ label: "Cracked Compass", quantity: 1 });
  });

  it("merges quantity when adding an existing item", () => {
    const g = game();
    g.inventory = [{ label: "Ration", description: "dry", quantity: 2 }];
    const scene = applyDeltas(g, { inventory: [{ op: "add", label: "ration", quantity: 3 }] });
    expect(scene.inventory).toHaveLength(1);
    expect(scene.inventory[0].quantity).toBe(5);
  });

  it("updates fields without touching quantity when omitted", () => {
    const g = game();
    g.inventory = [{ label: "Knife", description: "dull", quantity: 1 }];
    const scene = applyDeltas(g, { inventory: [{ op: "update", label: "Knife", description: "sharp" }] });
    expect(scene.inventory[0]).toMatchObject({ description: "sharp", quantity: 1 });
  });

  it("removes an item", () => {
    const g = game();
    g.inventory = [{ label: "Torch", description: "", quantity: 1 }];
    const scene = applyDeltas(g, { inventory: [{ op: "remove", label: "Torch" }] });
    expect(scene.inventory).toHaveLength(0);
  });

  it("leaves inventory untouched when no inventory deltas", () => {
    const g = game();
    g.inventory = [{ label: "Rope", description: "", quantity: 1 }];
    const scene = applyDeltas(g, { day: 2 });
    expect(scene.inventory).toBe(g.inventory);
  });
});

describe("applyDeltas — quest ops", () => {
  it("adds an active quest with reward", () => {
    const g = game();
    const scene = applyDeltas(g, {
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
    const scene = applyDeltas(g, { quests: [{ op: "update", label: "Find Water", status: "done" }] });
    expect(scene.quests[0].status).toBe("done");
  });

  it("does not duplicate an existing quest on add", () => {
    const g = game();
    g.quests = [{ id: "q1", label: "Find Water", description: "", reward: "", status: "active" }];
    const scene = applyDeltas(g, { quests: [{ op: "add", label: "find water" }] });
    expect(scene.quests).toHaveLength(1);
  });
});
