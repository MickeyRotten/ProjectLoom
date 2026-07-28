import { describe, expect, it } from "vitest";
import {
  D6_FACES,
  GRID_COLUMNS,
  PHASE,
  MAX_TILT,
  PERSPECTIVE_PX,
  SAFE_AREA,
  SCENE_TILT,
  SLOT_ROTATION,
  TIMING,
  facesFor,
  gridSpots,
  landedAt,
  leaveAt,
  planToss,
  scatterSpots,
  sceneView,
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

  it("throws dice up from off the bottom-left corner", () => {
    for (const die of planToss(roll({ count: 2, sides: 6, dice: [1, 6] }))) {
      expect(die.dx).toBeLessThan(-50); // off to the left
      expect(die.dy).toBeGreaterThan(50); // and below the screen
    }
  });

  it("uses pips only for a six-sided die", () => {
    expect(planToss(roll({ sides: 6 }))[0].pips).toBe(true);
    expect(planToss(roll({ sides: 20, roll: 17, total: 17 }))[0].pips).toBe(false);
  });
});

describe("timing", () => {
  it("holds the result after the last die lands", () => {
    expect(landedAt(1)).toBe(TIMING.fadeIn + TIMING.move);
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

describe("the surface", () => {
  it("tilts, but never far enough to turn the rolled face away", () => {
    // The dice land on a tilted table (`SCENE_TILT`), which is what makes a
    // landed cube read as a solid instead of a bordered square. Past 45° on
    // either axis the neighbouring face would be more camera-facing than the
    // one the turn actually rolled — the number has to stay the thing you see.
    expect(SCENE_TILT.x).not.toBe(0);
    expect(Math.abs(SCENE_TILT.x)).toBeLessThanOrEqual(MAX_TILT);
    expect(Math.abs(SCENE_TILT.y)).toBeLessThanOrEqual(MAX_TILT);
  });

  it("is one angle for every die, not one per die", () => {
    // Dice resting on a common table are parallel to each other; it is the
    // table that sits at an angle. Nothing in a die's plan may carry a tilt.
    const dice = planToss(roll({ roll: 9, total: 9, count: 3, sides: 6, dice: [4, 3, 2] }));
    for (const die of dice) {
      expect(die.rx1).toBe(SLOT_ROTATION[slotFor(die.faces, die.value)].rx);
      expect(die.ry1).toBe(SLOT_ROTATION[slotFor(die.faces, die.value)].ry);
    }
  });
});

describe("scatter, then collect", () => {
  it("lands every die inside the safe area", () => {
    // A die that scatters to the edge reads as escaping the screen, and on a
    // narrow phone it clips.
    for (const count of [1, 2, 3, 5, 10]) {
      for (const spot of scatterSpots(count, `seed|${count}`)) {
        expect(Math.abs(spot.x)).toBeLessThanOrEqual(SAFE_AREA.x);
        expect(Math.abs(spot.y)).toBeLessThanOrEqual(SAFE_AREA.y);
      }
    }
  });

  it("keeps a readable throw apart", () => {
    // Overlapping cubes are unreadable; this is the whole reason placement is
    // rejection-sampled rather than a plain random draw.
    const spots = scatterSpots(4, "seed|spread");
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const dx = (spots[i].x - spots[j].x) / 20;
        const dy = (spots[i].y - spots[j].y) / 13;
        expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("scatters the same roll the same way", () => {
    expect(scatterSpots(3, "same")).toEqual(scatterSpots(3, "same"));
    expect(scatterSpots(3, "same")).not.toEqual(scatterSpots(3, "other"));
  });

  it("collects into a row centred on nothing in particular", () => {
    // The block has to sit around one point however many dice there are —
    // otherwise a 2-dice row and a 3-dice row are centred differently.
    for (const count of [1, 2, 3, 5]) {
      const spots = gridSpots(count);
      expect(spots).toHaveLength(count);
      const sum = spots.reduce((n, s) => n + s.col, 0);
      expect(Math.abs(sum)).toBeLessThan(1e-9);
      expect(spots.every((s) => s.row === 0)).toBe(true);
    }
  });

  it("wraps to a grid past the row width, centring the short last row", () => {
    const spots = gridSpots(7);
    const rows = new Set(spots.map((s) => s.row));
    expect(rows.size).toBe(2);
    // Five on the first row, two on the second — and the two are centred on
    // their own width, not left-aligned under the five.
    const last = spots.slice(GRID_COLUMNS);
    expect(last.map((s) => s.col)).toEqual([-0.5, 0.5]);
  });

  it("gives each die its own spot and its own place in the row", () => {
    const dice = planToss(roll({ roll: 9, total: 9, count: 3, sides: 6, dice: [4, 3, 2] }));
    expect(new Set(dice.map((d) => `${d.sx},${d.sy}`)).size).toBe(3);
    expect(dice.map((d) => d.col)).toEqual([-1, 0, 1]);
  });
});

describe("phases", () => {
  it("keeps the timings in step with the keyframe stops", () => {
    // `TIMING` and the `loom-die-toss` keyframes describe the same animation
    // from two files. The percentages there are `PHASE`; if these drift, the
    // dice stop tumbling before or after they touch down.
    expect(TIMING.toss / TIMING.move).toBeCloseTo(PHASE.land, 3);
    expect((TIMING.toss + TIMING.scatter) / TIMING.move).toBeCloseTo(PHASE.gather, 2);
  });

  it("shows the result only once the dice have been collected", () => {
    expect(landedAt(1)).toBe(TIMING.fadeIn + TIMING.move);
    expect(landedAt(3)).toBe(landedAt(1) + TIMING.stagger * 2);
  });
});

describe("sceneView", () => {
  it("draws the scene the player set up", () => {
    expect(sceneView({ dicePitch: -12, diceYaw: 8, dicePerspective: true })).toEqual({
      x: -12,
      y: 8,
      perspective: `${PERSPECTIVE_PX}px`,
    });
  });

  it("flattens the scene when perspective is off", () => {
    // `none` is a real CSS value, not an absent one — it has to actually
    // flatten the scene rather than leave the property unset.
    expect(sceneView({ dicePerspective: false }).perspective).toBe("none");
  });

  it("falls back to the shipped view for anything missing", () => {
    expect(sceneView({})).toEqual({
      x: SCENE_TILT.x,
      y: SCENE_TILT.y,
      perspective: `${PERSPECTIVE_PX}px`,
    });
  });

  it("clamps a tilt that would turn the rolled face away", () => {
    // Past 45° the neighbouring face is the more camera-facing one and the toss
    // would be showing the wrong number — so this bound is correctness, not
    // taste, and it is enforced on READ so a stored value can't defeat it.
    expect(sceneView({ dicePitch: 400, diceYaw: -400 })).toMatchObject({
      x: MAX_TILT,
      y: -MAX_TILT,
    });
    expect(MAX_TILT).toBeLessThan(45);
    expect(sceneView({ dicePitch: NaN }).x).toBe(SCENE_TILT.x);
  });

  it("allows a dead-on view", () => {
    // 0/0 is a legitimate answer — some players will want the dice flat.
    expect(sceneView({ dicePitch: 0, diceYaw: 0 })).toMatchObject({ x: 0, y: 0 });
  });
});
