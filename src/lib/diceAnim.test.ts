import { describe, expect, it } from "vitest";
import {
  D6_FACES,
  SLOT_ROTATION,
  TIMING,
  facesFor,
  landedAt,
  leaveAt,
  planToss,
  slotFor,
  totalMs,
} from "./diceAnim";
import type { TurnRoll } from "../types";

const roll = (over: Partial<TurnRoll> = {}): TurnRoll => ({
  roll: 4,
  modifier: 0,
  total: 4,
  ...over,
});

describe("die faces", () => {
  it("pairs opposite faces to 7 on a d6", () => {
    // front/back, right/left, top/bottom — the DOM order the cube is built in.
    expect(D6_FACES[0] + D6_FACES[1]).toBe(7);
    expect(D6_FACES[2] + D6_FACES[3]).toBe(7);
    expect(D6_FACES[4] + D6_FACES[5]).toBe(7);
  });

  it("shows a non-d6's own numbers, rolled value first", () => {
    const faces = facesFor(17, 20);
    expect(faces).toHaveLength(6);
    expect(faces[0]).toBe(17);
    expect(faces.every((f) => f >= 1 && f <= 20)).toBe(true);
  });

  it("stays in range on a die with fewer sides than the cube has faces", () => {
    const faces = facesFor(2, 2);
    expect(faces).toHaveLength(6);
    expect(faces.every((f) => f === 1 || f === 2)).toBe(true);
  });

  it("falls back to the front slot for a value not on the die", () => {
    expect(slotFor(D6_FACES, 6)).toBe(1);
    expect(slotFor(D6_FACES, 99)).toBe(0);
  });
});

describe("planToss", () => {
  it("lands every die showing the face it rolled", () => {
    for (let value = 1; value <= 6; value++) {
      const [die] = planToss(roll({ roll: value, total: value }));
      // The landing pose must be the rotation that parks this value's slot at
      // the camera — a cube stopping on the wrong face is the one bug here that
      // nothing else in the app would catch.
      const slot = slotFor(die.faces, value);
      expect(die.faces[slot]).toBe(value);
      expect(die.rx1).toBe(SLOT_ROTATION[slot].rx);
      expect(die.ry1).toBe(SLOT_ROTATION[slot].ry);
    }
  });

  it("starts a whole number of turns back from where it lands", () => {
    for (const die of planToss(roll({ roll: 7, total: 7, count: 2, sides: 6, dice: [4, 3] }))) {
      expect(Math.abs(die.rx1 - die.rx0) % 360).toBe(0);
      expect(Math.abs(die.ry1 - die.ry0) % 360).toBe(0);
      // …and it must actually turn, or the die slides in without tumbling.
      expect(Math.abs(die.rx1 - die.rx0)).toBeGreaterThanOrEqual(360);
      expect(Math.abs(die.ry1 - die.ry0)).toBeGreaterThanOrEqual(360);
    }
  });

  it("throws one die per recorded face, staggered", () => {
    const dice = planToss(roll({ roll: 9, total: 9, count: 3, sides: 6, dice: [4, 3, 2] }));
    expect(dice.map((d) => d.value)).toEqual([4, 3, 2]);
    expect(dice.map((d) => d.delay)).toEqual([0, TIMING.stagger, TIMING.stagger * 2]);
  });

  it("reads a single-die record's total as the face", () => {
    const dice = planToss(roll({ roll: 5, total: 6, modifier: 1 }));
    expect(dice.map((d) => d.value)).toEqual([5]);
  });

  it("re-throws an identical roll identically", () => {
    // Regenerating a turn re-rolls the same seeded result (stakes.ts), so the
    // arc must repeat too — a new tumble would imply something changed.
    const r = roll({ roll: 7, total: 8, modifier: 1, count: 2, sides: 6, dice: [4, 3] });
    expect(planToss(r)).toEqual(planToss({ ...r }));
  });

  it("throws dice in from off-screen", () => {
    for (const die of planToss(roll({ count: 2, sides: 6, dice: [1, 6] }))) {
      expect(die.dy).toBeLessThan(-50);
      expect(Math.abs(die.dx)).toBeLessThanOrEqual(45);
    }
  });

  it("uses pips only for a six-sided die", () => {
    expect(planToss(roll({ sides: 6 }))[0].pips).toBe(true);
    expect(planToss(roll({ sides: 20, roll: 17, total: 17 }))[0].pips).toBe(false);
  });
});

describe("timing", () => {
  it("holds the result after the last die lands", () => {
    expect(landedAt(1)).toBe(TIMING.fadeIn + TIMING.toss);
    expect(landedAt(3)).toBe(landedAt(1) + TIMING.stagger * 2);
    expect(leaveAt(3)).toBe(landedAt(3) + TIMING.hold);
    expect(totalMs(3)).toBe(leaveAt(3) + TIMING.fadeOut);
  });

  it("skips straight to the result when motion is reduced", () => {
    expect(landedAt(4, true)).toBe(0);
    expect(totalMs(4, true)).toBe(TIMING.reduced);
    expect(totalMs(4, true)).toBeLessThan(totalMs(1));
  });
});
