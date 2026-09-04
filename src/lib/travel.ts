import type { Coords, Settings } from "../types";
import { type ChatMessage } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { completeChat } from "./openrouter";
import { avalanche, seedHash } from "./stakes";

/**
 * World coordinates — where a `Place` sits, relative to wherever the player
 * stood when it was discovered.
 *
 * Two-phase, like the sheet itself (`generatePlace.ts`): the instant a new
 * place is stubbed, `store.ts` gives it a position for free — a deterministic
 * guess seeded off `(turn, action)`, the same key `stakes.ts → rollDice` uses,
 * so it reproduces exactly on regenerate and costs nothing even with the
 * cheap model disabled, failing, or timing out. Afterwards, a cheap-model call
 * (`Settings.cheapModelId`, mirroring `verifyOps.ts`'s shape) may read the
 * arrival prose and refine the guess into a direction and distance the text
 * actually supports. Once set, a place's coords are frozen exactly like the
 * rest of its sheet — nothing revisits or moves a place once it has one.
 *
 * Movement is a closed 6-direction ladder (no diagonals — a cheap model
 * classifies far more reliably picking one of six than one of eight) and a
 * closed distance ladder (`clock.ts → DurationLabel`'s template: the model
 * only ever names a label, the client owns every number).
 */

export type DirectionLabel = "north" | "south" | "east" | "west" | "up" | "down";

export const DIRECTION_LABELS: DirectionLabel[] = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
];

export const DIRECTION_VECTORS: Record<DirectionLabel, Coords> = {
  north: { x: 0, y: 1, z: 0 },
  south: { x: 0, y: -1, z: 0 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 0, z: 1 },
  down: { x: 0, y: 0, z: -1 },
};

export const DEFAULT_DIRECTION: DirectionLabel = "north";

export type DistanceLabel = "step" | "short" | "moderate" | "long" | "epic";

export const DISTANCE_LABELS: DistanceLabel[] = ["step", "short", "moderate", "long", "epic"];

/** Abstract units — there is no real-world scale here, only relative distance. */
export const DISTANCE_UNITS: Record<DistanceLabel, number> = {
  step: 1,
  short: 3,
  moderate: 8,
  long: 20,
  epic: 50,
};

export const DEFAULT_DISTANCE: DistanceLabel = "short";

/** Sanitize-at-read, like `clock.ts → normalizeDuration`: garbage falls to the default label rather than erroring. */
export function normalizeDirection(raw: unknown): DirectionLabel {
  if (typeof raw !== "string") return DEFAULT_DIRECTION;
  const key = raw.trim().toLowerCase();
  const found = DIRECTION_LABELS.find((d) => d === key);
  return found ?? DEFAULT_DIRECTION;
}

export function normalizeDistance(raw: unknown): DistanceLabel {
  if (typeof raw !== "string") return DEFAULT_DISTANCE;
  const key = raw.trim().toLowerCase();
  const found = DISTANCE_LABELS.find((d) => d === key);
  return found ?? DEFAULT_DISTANCE;
}

/** Pure arithmetic — one direction, one distance, one new point. */
export function applyMovement(from: Coords, direction: DirectionLabel, distance: DistanceLabel): Coords {
  const v = DIRECTION_VECTORS[direction];
  const u = DISTANCE_UNITS[distance];
  return { x: from.x + v.x * u, y: from.y + v.y * u, z: from.z + v.z * u };
}

// A mixing constant of our own — travel.ts only reuses stakes.ts's exported
// seedHash/avalanche, it doesn't reach into that module's internals (GOLDEN).
const MIX = 0x9e3779b9;

/**
 * The zero-network guess. Seeded off `travel|${turn}|${action}` — the same
 * `(turn, action-text)` shape `rollDice` seeds on, so it reproduces exactly on
 * regenerate (which resends the same turn number and the same player text)
 * with no extra wiring, and a distinct namespace (`travel|`) so it never
 * happens to collide with a stakes roll seeded the same turn.
 */
export function fallbackMovement(
  turn: number,
  action: string,
): { direction: DirectionLabel; distance: DistanceLabel } {
  const base = avalanche(seedHash(`travel|${turn}|${action.trim().toLowerCase()}`));
  const direction = DIRECTION_LABELS[base % DIRECTION_LABELS.length];
  const distance = DISTANCE_LABELS[avalanche((base + MIX) >>> 0) % DISTANCE_LABELS.length];
  return { direction, distance };
}

export function fallbackCoords(from: Coords, turn: number, action: string): Coords {
  const { direction, distance } = fallbackMovement(turn, action);
  return applyMovement(from, direction, distance);
}

/* ------------------------------------------------------------------ *
 * Cheap-model refinement — verifyOps.ts's shape
 * ------------------------------------------------------------------ */

/** A short, structured classification — not narration, so a cheap model is plenty. */
export const ESTIMATE_TRAVEL_TEMPERATURE = 0.1;

export interface TravelEstimate {
  direction: DirectionLabel;
  distance: DistanceLabel;
}

/**
 * The messages[] for one estimate call: the action the player typed and the
 * prose the narrator wrote in response, nothing else — no history, no
 * sheets, no place data. The question is narrow ("which way, how far"), and
 * everything else would be tokens spent on a world the model doesn't need to
 * understand to answer it.
 */
export function buildTravelMessages(action: string, prose: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "TRAVEL CHECK — a narrator just wrote one beat of a text adventure in which the player moved to a new place.",
        'Judge, from the text below, roughly which of six directions the player travelled — "north", "south", "east", "west", "up", or "down" — and roughly how far — "step" (right next door), "short" (a nearby room or street), "moderate" (across a building or into the next district), "long" (a real journey — riding, sailing, a day\'s walk), or "epic" (an epic trek — days or weeks of travel, a different region entirely).',
        "Pick whichever axis and scale best fit the text even if the prose never names a compass direction — infer it from what is described.",
        'Reply with a single JSON object and nothing else — no prose, no code fences: {"direction": "...", "distance": "..."}.',
      ].join("\n"),
    },
    {
      role: "user",
      content: `ACTION\n${action.trim()}\n\nPROSE\n${prose.trim()}\n\nEmit the JSON object now.`,
    },
  ];
}

/**
 * Tolerant parse. Unlike `verifyOps.ts → parseVerifyResult` there is no
 * neutral "keep it as it was" value for a direction or a distance, so the
 * fail-open line sits one level up: no JSON object anywhere in the reply
 * returns `null` and the caller keeps the deterministic fallback already
 * placed. Once ANY object is found, a missing or garbled sub-field falls
 * back through `normalizeDirection`/`normalizeDistance` rather than
 * discarding a reply that got the other field right.
 */
export function parseTravelEstimate(raw: string): TravelEstimate | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return null;
  return {
    direction: normalizeDirection(parsed.direction),
    distance: normalizeDistance(parsed.distance),
  };
}

export interface EstimateTravelOptions {
  settings: Settings;
  action: string;
  prose: string;
  signal?: AbortSignal;
}

/**
 * The network half. Fails open on anything — a bad key, a timeout, the
 * player pressing Stop, an unparseable reply — by returning `null`, which
 * tells the caller to leave the deterministic placement exactly where it
 * already put the place. A broken or slow estimator can only ever leave
 * today's guess in place, never worse.
 */
export async function estimateTravel(opts: EstimateTravelOptions): Promise<TravelEstimate | null> {
  try {
    const raw = await completeChat({
      settings: opts.settings,
      model: opts.settings.cheapModelId.trim() || opts.settings.textModelId,
      messages: buildTravelMessages(opts.action, opts.prose),
      signal: opts.signal,
      temperature: ESTIMATE_TRAVEL_TEMPERATURE,
    });
    return parseTravelEstimate(raw);
  } catch {
    return null;
  }
}
