import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISTANCE,
  DEFAULT_HORIZONTAL,
  DEFAULT_VERTICAL,
  DISTANCE_LABELS,
  HORIZONTAL_LABELS,
  VERTICAL_LABELS,
  applyMovement,
  buildTravelMessages,
  fallbackCoords,
  fallbackMovement,
  normalizeDistance,
  normalizeHorizontal,
  normalizeVertical,
  parseTravelEstimate,
} from "./travel";

describe("applyMovement", () => {
  const origin = { x: 0, y: 0, z: 0 };

  it("moves along each horizontal axis, vertical none", () => {
    expect(applyMovement(origin, { horizontal: "north", vertical: "none", distance: "step" })).toEqual({
      x: 0,
      y: 1,
      z: 0,
    });
    expect(applyMovement(origin, { horizontal: "south", vertical: "none", distance: "step" })).toEqual({
      x: 0,
      y: -1,
      z: 0,
    });
    expect(applyMovement(origin, { horizontal: "east", vertical: "none", distance: "step" })).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    expect(applyMovement(origin, { horizontal: "west", vertical: "none", distance: "step" })).toEqual({
      x: -1,
      y: 0,
      z: 0,
    });
  });

  it("moves along the vertical axis independently of horizontal", () => {
    expect(applyMovement(origin, { horizontal: "north", vertical: "up", distance: "step" })).toEqual({
      x: 0,
      y: 1,
      z: 1,
    });
    expect(applyMovement(origin, { horizontal: "north", vertical: "down", distance: "step" })).toEqual({
      x: 0,
      y: 1,
      z: -1,
    });
    expect(applyMovement(origin, { horizontal: "north", vertical: "none", distance: "step" })).toEqual({
      x: 0,
      y: 1,
      z: 0,
    });
  });

  it("lands on both axes at once — the regression case for the windmill hills bug", () => {
    // A move that is both away from the start AND uphill must show up on
    // BOTH axes, not collapse to just one — this is exactly the shipped bug:
    // "make for the windmill hills" resolved to (0,0,3), reading as
    // "teleported straight up," discarding the southward leg entirely.
    expect(applyMovement(origin, { horizontal: "south", vertical: "up", distance: "short" })).toEqual({
      x: 0,
      y: -3,
      z: 3,
    });
  });

  it("scales by the distance label, shared across both axes", () => {
    expect(applyMovement(origin, { horizontal: "east", vertical: "none", distance: "short" })).toEqual({
      x: 3,
      y: 0,
      z: 0,
    });
    expect(applyMovement(origin, { horizontal: "east", vertical: "none", distance: "moderate" })).toEqual({
      x: 8,
      y: 0,
      z: 0,
    });
    expect(applyMovement(origin, { horizontal: "east", vertical: "none", distance: "long" })).toEqual({
      x: 20,
      y: 0,
      z: 0,
    });
    expect(applyMovement(origin, { horizontal: "east", vertical: "none", distance: "epic" })).toEqual({
      x: 50,
      y: 0,
      z: 0,
    });
  });

  it("offsets from a nonzero starting point", () => {
    expect(
      applyMovement({ x: 5, y: -5, z: 2 }, { horizontal: "north", vertical: "none", distance: "short" }),
    ).toEqual({ x: 5, y: -2, z: 2 });
  });
});

describe("normalizeHorizontal", () => {
  it("keeps a valid label, case and whitespace insensitively", () => {
    for (const d of HORIZONTAL_LABELS) {
      expect(normalizeHorizontal(`  ${d.toUpperCase()}  `)).toBe(d);
    }
  });

  it("falls back on garbage or the wrong type", () => {
    expect(normalizeHorizontal("up")).toBe(DEFAULT_HORIZONTAL);
    expect(normalizeHorizontal(undefined)).toBe(DEFAULT_HORIZONTAL);
    expect(normalizeHorizontal(7)).toBe(DEFAULT_HORIZONTAL);
  });
});

describe("normalizeVertical", () => {
  it("keeps a valid label, case and whitespace insensitively — including none", () => {
    for (const d of VERTICAL_LABELS) {
      expect(normalizeVertical(`  ${d.toUpperCase()}  `)).toBe(d);
    }
  });

  it("falls back on garbage or the wrong type", () => {
    expect(normalizeVertical("sideways")).toBe(DEFAULT_VERTICAL);
    expect(normalizeVertical(undefined)).toBe(DEFAULT_VERTICAL);
    expect(normalizeVertical(7)).toBe(DEFAULT_VERTICAL);
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
      const { horizontal, vertical, distance } = fallbackMovement(turn, `action ${turn}`);
      expect(HORIZONTAL_LABELS).toContain(horizontal);
      expect(VERTICAL_LABELS).toContain(vertical);
      expect(DISTANCE_LABELS).toContain(distance);
    }
  });

  it("picks vertical none often — it is a bonus axis, not a third equal option", () => {
    // Guards against a future mixing-constant change accidentally making
    // vertical always-nonzero, which would defeat "usually none" and make
    // every ordinary lateral move gain spurious elevation.
    const verticals = Array.from({ length: 40 }, (_, i) => fallbackMovement(i, `action ${i}`).vertical);
    expect(verticals).toContain("none");
  });

  it("is case/whitespace-insensitive on the action text — matches rollDice's seed normalization", () => {
    const a = fallbackMovement(1, "Walk North");
    const b = fallbackMovement(1, "  walk north  ");
    expect(a).toEqual(b);
  });

  it("fallbackCoords applies the picked movement from the given origin", () => {
    const from = { x: 1, y: 1, z: 1 };
    const movement = fallbackMovement(9, "go somewhere");
    expect(fallbackCoords(from, 9, "go somewhere")).toEqual(applyMovement(from, movement));
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

  it("documents both independent axes, so a future edit can't silently drop one", () => {
    const joined = buildTravelMessages("go", "prose")
      .map((m) => m.content)
      .join("\n");
    expect(joined).toContain("horizontal");
    expect(joined).toContain("vertical");
    expect(joined).toContain("none");
  });
});

describe("parseTravelEstimate", () => {
  it("reads a well-formed reply", () => {
    const raw = '{"horizontal":"east","vertical":"up","distance":"long"}';
    expect(parseTravelEstimate(raw)).toEqual({ horizontal: "east", vertical: "up", distance: "long" });
  });

  it("reads the windmill-hills case end to end", () => {
    const raw = '{"horizontal":"south","vertical":"up","distance":"short"}';
    const movement = parseTravelEstimate(raw);
    expect(movement).toEqual({ horizontal: "south", vertical: "up", distance: "short" });
    expect(applyMovement({ x: 0, y: 0, z: 0 }, movement!)).toEqual({ x: 0, y: -3, z: 3 });
  });

  it("falls a garbled horizontal back to its default without discarding the rest", () => {
    const raw = '{"horizontal":"sideways","vertical":"up","distance":"long"}';
    expect(parseTravelEstimate(raw)).toEqual({ horizontal: DEFAULT_HORIZONTAL, vertical: "up", distance: "long" });
  });

  it("falls a garbled vertical back to its default without discarding the rest", () => {
    const raw = '{"horizontal":"west","vertical":"sideways","distance":"long"}';
    expect(parseTravelEstimate(raw)).toEqual({ horizontal: "west", vertical: DEFAULT_VERTICAL, distance: "long" });
  });

  it("falls a missing vertical back to none", () => {
    const raw = '{"horizontal":"west","distance":"long"}';
    expect(parseTravelEstimate(raw)).toEqual({ horizontal: "west", vertical: "none", distance: "long" });
  });

  it("falls a missing field back to its default", () => {
    const raw = '{"horizontal":"west"}';
    expect(parseTravelEstimate(raw)).toEqual({
      horizontal: "west",
      vertical: DEFAULT_VERTICAL,
      distance: DEFAULT_DISTANCE,
    });
  });

  it("returns null when no JSON object is found at all — the caller keeps its fallback placement", () => {
    expect(parseTravelEstimate("not json at all")).toBeNull();
    expect(parseTravelEstimate("")).toBeNull();
  });

  it("tolerates fences and preamble", () => {
    const raw = 'Sure, here you go:\n```json\n{"horizontal":"north","vertical":"up","distance":"step"}\n```';
    expect(parseTravelEstimate(raw)).toEqual({ horizontal: "north", vertical: "up", distance: "step" });
  });
});
