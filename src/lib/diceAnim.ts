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
  /**
   * A die's whole journey: thrown in, scattered where it lands, then collected
   * into the row. ONE animation with three segments (`loom-die-toss` in
   * theme.css) rather than three animations, so nothing can drift out of step.
   */
  move: 1400,
  /**
   * How long of `move` the die is still in the air and tumbling — the cube's
   * spin runs for exactly this. Must stay in step with the **50%** stop in the
   * keyframes, which is where the die touches down; there is a test.
   */
  toss: 700,
  /**
   * The pause between landing scattered and being collected, so the throw is
   * legible as a throw before it becomes a tidy row. Matches the gap between
   * the keyframes' 50% and **71%** stops.
   */
  scatter: 294,
  /** Gap between consecutive dice landing. */
  stagger: 90,
  /** How long the collected result stays up to be read. */
  hold: 900,
  /** The layer fading back out. */
  fadeOut: 320,
  /**
   * The whole thing when the reader has asked the OS for less motion: the result
   * appears, is held briefly, and leaves. Nothing tumbles.
   */
  reduced: 900,
};

/**
 * The keyframe stops `loom-die-toss` is written with, as fractions of `move`.
 * CSS keyframes take literal percentages, so these are the one place the two
 * files agree — `TIMING` is checked against them in the tests.
 */
export const PHASE = { land: 0.5, gather: 0.71 };

/** When the last die has been collected and the total can be shown. */
export function landedAt(count: number, reduced = false): number {
  if (reduced) return 0;
  return TIMING.fadeIn + TIMING.move + TIMING.stagger * Math.max(0, count - 1);
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
  /** Where it first lands — scattered, in vw/vh from the centre of the screen. */
  sx: number;
  sy: number;
  /**
   * Where it is collected to, in whole dice-widths from the centre of the row.
   * Units rather than lengths because the die's size is a CSS `clamp()` the
   * layout resolves — the component multiplies these by it.
   */
  col: number;
  row: number;
  /** Stagger, in ms. */
  delay: number;
}

/**
 * The tilt of the SURFACE the dice land on — a table seen from a few degrees
 * above and a few to the side, rather than a sheet of glass square to the
 * camera.
 *
 * One rotation, shared by every die. That is the whole point: dice resting on a
 * common surface are parallel to each other, and it is the surface that is at an
 * angle to the viewer. Tilting each die by its own amount would say the opposite
 * — that they came to rest on nothing in particular.
 *
 * Deliberately slight. It only has to break the symmetry: at 3° a landed cube
 * shows a hairline of its top and side, which is enough to read as a solid
 * rather than a bordered square, while the rolled face stays square-on and
 * perfectly legible. The tumble is where the depth is sold; this is the resting
 * pose not throwing that away.
 */
export const SCENE_TILT = { x: -3, y: 3 };

/**
 * How far from the centre of the screen a die may land, in vw/vh. Deliberately
 * short of the edges: a die that scatters into the corner reads as escaping the
 * screen, and on a narrow phone it would clip.
 */
export const SAFE_AREA = { x: 30, y: 22 };

/**
 * Minimum spacing between two scattered dice, in vw/vh — roughly a die's own
 * footprint, so a throw reads as several dice rather than one clump. Different
 * per axis because vw and vh are different lengths on a phone and the die is
 * square in neither.
 */
const MIN_SPACING = { x: 20, y: 13 };

/** Dice per row once they are collected — beyond this the row wraps to a grid. */
export const GRID_COLUMNS = 5;

/**
 * Where the dice come to rest as a tidy block: a centred row, wrapping to a
 * grid past `GRID_COLUMNS`. Both axes are centred on 0, so the block sits
 * around one point however many dice there are and whatever the last row holds.
 */
export function gridSpots(count: number): { col: number; row: number }[] {
  const perRow = Math.min(count, GRID_COLUMNS);
  const rows = Math.ceil(count / perRow);
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / perRow);
    // The last row is usually short — centre it on its OWN width, or a 7-dice
    // throw ends with two dice hanging off to the left.
    const inRow = Math.min(perRow, count - row * perRow);
    const col = (i % perRow) - (inRow - 1) / 2;
    return { col, row: row - (rows - 1) / 2 };
  });
}

/** Are two scatter spots far enough apart to read as two dice? */
function clear(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const dx = (a.x - b.x) / MIN_SPACING.x;
  const dy = (a.y - b.y) / MIN_SPACING.y;
  return dx * dx + dy * dy >= 1;
}

/**
 * Where the dice first land — scattered across the safe area, seeded so the
 * same roll scatters the same way.
 *
 * Placed by rejection: draw a spot, keep it if it clears the dice already down,
 * otherwise draw again. Pure randomness clumps, and a clump of overlapping
 * cubes is unreadable; a grid with jitter reads as a grid. After `TRIES` the
 * last candidate is taken regardless — with ten dice in this area there is no
 * arrangement that clears, and a slightly crowded throw beats no throw.
 */
export function scatterSpots(count: number, seed: string): { x: number; y: number }[] {
  const TRIES = 12;
  const spots: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    let spot = { x: 0, y: 0 };
    for (let t = 0; t < TRIES; t++) {
      const h = seedHash(`${seed}|scatter|${i}|${t}`);
      spot = {
        x: ((h % (SAFE_AREA.x * 2 + 1)) - SAFE_AREA.x) | 0,
        y: (((h >>> 11) % (SAFE_AREA.y * 2 + 1)) - SAFE_AREA.y) | 0,
      };
      if (spots.every((s) => clear(spot, s))) break;
    }
    spots.push(spot);
  }
  return spots;
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
  const seed = `${roll.total}|${roll.roll}|${values.join(",")}`;
  const scatter = scatterSpots(values.length, seed);
  const grid = gridSpots(values.length);

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
      // Thrown UP from off the bottom-left corner — the dice come from the
      // player's own hand, out of frame, rather than dropping in from nowhere.
      dx: -75 - ((h >>> 8) % 35),
      dy: 60 + ((h >>> 16) % 30),
      // Where the throw scatters them, and where they are collected to.
      sx: scatter[i].x,
      sy: scatter[i].y,
      col: grid[i].col,
      row: grid[i].row,
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
