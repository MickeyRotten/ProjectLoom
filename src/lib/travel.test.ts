import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIRECTION,
  DEFAULT_DISTANCE,
  DIRECTION_LABELS,
  DISTANCE_LABELS,
  applyMovement,
  buildTravelMessages,
  fallbackCoords,
  fallbackMovement,
  normalizeDirection,
  normalizeDistance,
  parseTravelEstimate,
} from "./travel";

describe("applyMovement", () => {
  const origin = { x: 0, y: 0, z: 0 };

  it("moves along each of the six axes", () => {
    expect(applyMovement(origin, "north", "step")).toEqual({ x: 0, y: 1, z: 0 });
    expect(applyMovement(origin, "south", "step")).toEqual({ x: 0, y: -1, z: 0 });
    expect(applyMovement(origin, "east", "step")).toEqual({ x: 1, y: 0, z: 0 });
    expect(applyMovement(origin, "west", "step")).toEqual({ x: -1, y: 0, z: 0 });
    expect(applyMovement(origin, "up", "step")).toEqual({ x: 0, y: 0, z: 1 });
    expect(applyMovement(origin, "down", "step")).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("scales by the distance label", () => {
    expect(applyMovement(origin, "east", "short")).toEqual({ x: 3, y: 0, z: 0 });
    expect(applyMovement(origin, "east", "moderate")).toEqual({ x: 8, y: 0, z: 0 });
    expect(applyMovement(origin, "east", "long")).toEqual({ x: 20, y: 0, z: 0 });
    expect(applyMovement(origin, "east", "epic")).toEqual({ x: 50, y: 0, z: 0 });
  });

  it("offsets from a nonzero starting point", () => {
    expect(applyMovement({ x: 5, y: -5, z: 2 }, "north", "short")).toEqual({ x: 5, y: -2, z: 2 });
  });
});

describe("normalizeDirection", () => {
  it("keeps a valid label, case and whitespace insensitively", () => {
    for (const d of DIRECTION_LABELS) {
      expect(normalizeDirection(`  ${d.toUpperCase()}  `)).toBe(d);
    }
  });

  it("falls back on garbage or the wrong type", () => {
    expect(normalizeDirection("sideways")).toBe(DEFAULT_DIRECTION);
    expect(normalizeDirection(undefined)).toBe(DEFAULT_DIRECTION);
    expect(normalizeDirection(7)).toBe(DEFAULT_DIRECTION);
  });
});

describe("normalizeDistance", () => {
  it("keeps a valid label, case and whitespace insensitively", () => {
    for (const d of DISTANCE_LABELS) {
      expect(normalizeDistance(`  ${d.toUpperCase()}  `)).toBe(d);
    }
  });

  it("falls back on garbage or the wrong type", () => {
    expect(normalizeDistance("a mile or so")).toBe(DEFAULT_DISTANCE);
    expect(normalizeDistance(null)).toBe(DEFAULT_DISTANCE);
  });
});

describe("fallbackMovement / fallbackCoords", () => {
  it("is deterministic — the same (turn, action) always gives the same pick", () => {
    const a = fallbackMovement(4, "I travel north to the old mill");
    const b = fallbackMovement(4, "I travel north to the old mill");
    expect(a).toEqual(b);
  });

  it("always returns a member of each ladder", () => {
    for (let turn = 0; turn < 20; turn++) {
      const { direction, distance } = fallbackMovement(turn, `action ${turn}`);
      expect(DIRECTION_LABELS).toContain(direction);
      expect(DISTANCE_LABELS).toContain(distance);
    }
  });

  it("is case/whitespace-insensitive on the action text — matches rollDice's seed normalization", () => {
    const a = fallbackMovement(1, "Walk North");
    const b = fallbackMovement(1, "  walk north  ");
    expect(a).toEqual(b);
  });

  it("fallbackCoords applies the picked direction/distance from the given origin", () => {
    const from = { x: 1, y: 1, z: 1 };
    const { direction, distance } = fallbackMovement(9, "go somewhere");
    expect(fallbackCoords(from, 9, "go somewhere")).toEqual(applyMovement(from, direction, distance));
  });
});

describe("buildTravelMessages", () => {
  it("carries the action and the prose, nothing else", () => {
    const joined = buildTravelMessages("I journey north to the old keep", "You trudge for hours through fog.")
      .map((m) => m.content)
      .join("\n");
    expect(joined).toContain("I journey north to the old keep");
    expect(joined).toContain("You trudge for hours through fog.");
  });
});

describe("parseTravelEstimate", () => {
  it("reads a well-formed reply", () => {
    const raw = '{"direction":"east","distance":"long"}';
    expect(parseTravelEstimate(raw)).toEqual({ direction: "east", distance: "long" });
  });

  it("falls a garbled sub-field back to its default without discarding the other", () => {
    const raw = '{"direction":"sideways","distance":"long"}';
    expect(parseTravelEstimate(raw)).toEqual({ direction: DEFAULT_DIRECTION, distance: "long" });
  });

  it("falls a missing field back to its default", () => {
    const raw = '{"direction":"west"}';
    expect(parseTravelEstimate(raw)).toEqual({ direction: "west", distance: DEFAULT_DISTANCE });
  });

  it("returns null when no JSON object is found at all — the caller keeps its fallback placement", () => {
    expect(parseTravelEstimate("not json at all")).toBeNull();
    expect(parseTravelEstimate("")).toBeNull();
  });

  it("tolerates fences and preamble", () => {
    const raw = 'Sure, here you go:\n```json\n{"direction":"up","distance":"step"}\n```';
    expect(parseTravelEstimate(raw)).toEqual({ direction: "up", distance: "step" });
  });
});
