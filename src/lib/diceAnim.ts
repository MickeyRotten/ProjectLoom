import type { TurnRoll } from "../types";
import { seedHash } from "./stakes";

/**
 * Dice toss — the staging for the full-screen roll (`DiceOverlay`).
 *
 * This file decides NOTHING about the result. `stakes.ts` has already rolled by
 * the time anything here runs; every number below is choreography for faces that
 * are already known, in the same spirit as the tabletop-RPG video games this is
 * modelled on: the die you watch tumble is landing on a result the game settled
 * before it left your hand.
 *
 * Why a planner rather than transforms written inline in the component: the
 * geometry is the part that can be silently WRONG — a cube can happily land
 * showing a face that isn't the number the turn resolved on, and nothing in the
 * UI would complain. It is pure and tested for that reason.
 *
 * The choreography is seeded off the roll itself, so a regenerate — which
 * re-rolls the same seeded result (`stakes.ts`) — also re-throws the same arc.
 * Two identical rolls looking identical is the honest reading: nothing new
 * happened.
 */

/** Which way the cube must turn to bring a given face to the camera. */
interface FaceRotation {
  rx: number;
  ry: number;
}

/**
 * The cube's six faces, in DOM order: front, back, right, left, top, bottom.
 * A real die has opposite faces summing to 7, which this ordering keeps
 * (1/6, 3/4, 5/2) — the pips are visible in the tumble, so a die that pairs its
 * faces wrongly reads as a toy.
 */
export const D6_FACES = [1, 6, 3, 4, 5, 2];

/**
 * The rotation that parks each slot facing the viewer. Indexed by slot, not by
 * pip count, so a non-d6 die (which puts its own numerals on the slots) reads
 * from the same table.
 */
export const SLOT_ROTATION: FaceRotation[] = [
  { rx: 0, ry: 0 }, // front
  { rx: 0, ry: 180 }, // back
  { rx: 0, ry: -90 }, // right
  { rx: 0, ry: 90 }, // left
  { rx: -90, ry: 0 }, // top
  { rx: 90, ry: 0 }, // bottom
];

/**
 * Milliseconds. The whole thing is deliberately short: it plays on EVERY risky
 * turn, and an animation you sit through twenty times an hour has to be over
 * before it becomes something to skip. It also overlaps the wait for the model's
 * first token, so most of it costs no time at all.
 */
export const TIMING = {
  /** The layer fading in over the game. */
  fadeIn: 180,
  /** One die, thrown to its resting place. */
  toss: 820,
  /** Gap between consecutive dice landing. */
  stagger: 90,
  /** How long the landed result stays up to be read. */
  hold: 1000,
  /** The layer fading back out. */
  fadeOut: 320,
  /**
   * The whole thing when the reader has asked the OS for less motion: the result
   * appears, is held briefly, and leaves. Nothing tumbles.
   */
  reduced: 900,
};

/** When the last die has landed and the total can be shown. */
export function landedAt(count: number, reduced = false): number {
  if (reduced) return 0;
  return TIMING.fadeIn + TIMING.toss + TIMING.stagger * Math.max(0, count - 1);
}

/** When the layer starts fading out. */
export function leaveAt(count: number, reduced = false): number {
  if (reduced) return Math.max(0, TIMING.reduced - TIMING.fadeOut);
  return landedAt(count) + TIMING.hold;
}

/** Total lifetime of one cast, from fade-in to gone. */
export function totalMs(count: number, reduced = false): number {
  return leaveAt(count, reduced) + TIMING.fadeOut;
}

/** One die's staging — everything the component needs to throw it. */
export interface DieToss {
  /** The face this die landed on. */
  value: number;
  /** What each of the six cube slots shows, in DOM order. */
  faces: number[];
  /** Draw pips rather than a numeral — only a six-sided die has a pip layout. */
  pips: boolean;
  /** Start pose (degrees), several whole turns back from the landing pose. */
  rx0: number;
  ry0: number;
  /** Landing pose — brings `value`'s slot to the camera. */
  rx1: number;
  ry1: number;
  /** Where the die is thrown from, as a viewport-relative offset. */
  dx: number;
  dy: number;
  /** Stagger, in ms. */
  delay: number;
}

/**
 * What the six slots show on a die that isn't a d6.
 *
 * The rolled value takes the front slot and the rest walk away from it in even
 * steps, so a d20 shows a spread of its own numbers rather than 1–6 with a
 * stranger on the front. Values repeat when the die has fewer than six sides —
 * a d2 genuinely has nothing else to show.
 */
export function facesFor(value: number, sides: number): number[] {
  if (sides === 6) return D6_FACES;
  const step = Math.max(1, Math.floor(sides / 6));
  return Array.from({ length: 6 }, (_, i) => ((value - 1 + i * step) % sides) + 1);
}

/**
 * Which slot a value sits on, and therefore where the cube has to stop. Falls
 * back to the front slot: a value that somehow isn't on the die is still shown
 * rather than landing on a face that reads as a different number.
 */
export function slotFor(faces: number[], value: number): number {
  const i = faces.indexOf(value);
  return i === -1 ? 0 : i;
}

/** The dice this record actually knows the faces of. */
function facesRolled(roll: TurnRoll): number[] {
  // `rollRecord` only writes the individual faces for multi-dice systems: on a
  // single die the total IS the face. A record whose array disagrees with its
  // count (hand-edited, or from a build that wrote them differently) is trusted
  // for what it holds — showing the faces we have beats inventing the rest.
  if (roll.dice?.length) return roll.dice;
  return [roll.roll];
}

/**
 * Stage the throw. Pure in the roll: the same `TurnRoll` always produces the
 * same arcs, so a regenerated turn re-throws identically.
 */
export function planToss(roll: TurnRoll): DieToss[] {
  const sides = roll.sides ?? 6;
  const values = facesRolled(roll);

  return values.map((value, i) => {
    const h = seedHash(`${roll.total}|${roll.roll}|${value}|${i}`);
    const faces = facesFor(value, sides);
    const landing = SLOT_ROTATION[slotFor(faces, value)];

    // Whole turns only — the die has to finish square to the camera, so every
    // spin added to the landing pose is a multiple of 360°.
    const spinX = (2 + (h % 3)) * ((h & 0x40) === 0 ? 1 : -1);
    const spinY = (1 + ((h >>> 3) % 3)) * ((h & 0x80) === 0 ? 1 : -1);

    return {
      value,
      faces,
      pips: sides === 6,
      rx1: landing.rx,
      ry1: landing.ry,
      rx0: landing.rx - 360 * spinX,
      ry0: landing.ry - 360 * spinY,
      // Thrown in from above and off to one side, so the dice arrive from
      // somewhere rather than growing where they land.
      dx: ((h >>> 8) % 90) - 45,
      dy: -70 - ((h >>> 16) % 25),
      delay: i * TIMING.stagger,
    };
  });
}

/**
 * Pip positions on a 3×3 grid, as `[column, row]` 1-indexed — the standard
 * layout, so a 5 reads as a 5 at a glance mid-tumble.
 */
export const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [
    [1, 1],
    [3, 3],
  ],
  3: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  4: [
    [1, 1],
    [3, 1],
    [1, 3],
    [3, 3],
  ],
  5: [
    [1, 1],
    [3, 1],
    [2, 2],
    [1, 3],
    [3, 3],
  ],
  6: [
    [1, 1],
    [3, 1],
    [1, 2],
    [3, 2],
    [1, 3],
    [3, 3],
  ],
};
