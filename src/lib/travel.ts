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
 * arrival prose and refine the guess into a movement the text actually
 * supports. Once set, a place's coords are frozen exactly like the rest of
 * its sheet — nothing revisits or moves a place once it has one.
 *
 * Movement is TWO independent axes, not one: a closed 4-way horizontal ladder
 * (always picked) plus an independent up/down/none vertical bonus axis
 * (usually none), summed together. A single closed 6-direction ladder
 * (north/south/east/west/up/down, exactly one wins) shipped first and broke
 * on the first hillside: "make for the windmill hills" is a move that is both
 * away from the crossroads AND uphill, and a single pick forces a destructive
 * either/or between them — the shipped bug showed a move landing on
 * `(0, 0, 3)`, reading as "teleported straight up," when the beat plainly
 * described moving away to the south as well. Horizontal has no "none": every
 * location change must produce a nonzero displacement, and a "none" escape
 * hatch on both axes would let a room land on the exact point the player just
 * left. Distance stays one shared closed ladder scaling whichever axes are
 * active (`clock.ts → DurationLabel`'s template: the model only ever names a
 * label, the client owns every number) — per-axis distance would double the
 * classification surface for units that are already documented as abstract.
 */

export type HorizontalLabel = "north" | "south" | "east" | "west";

export const HORIZONTAL_LABELS: HorizontalLabel[] = ["north", "south", "east", "west"];

export const HORIZONTAL_VECTORS: Record<HorizontalLabel, Coords> = {
  north: { x: 0, y: 1, z: 0 },
  south: { x: 0, y: -1, z: 0 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
};

export const DEFAULT_HORIZONTAL: HorizontalLabel = "north";

export type VerticalLabel = "up" | "down" | "none";

export const VERTICAL_LABELS: VerticalLabel[] = ["up", "down", "none"];

export const VERTICAL_VECTORS: Record<VerticalLabel, Coords> = {
  up: { x: 0, y: 0, z: 1 },
  down: { x: 0, y: 0, z: -1 },
  none: { x: 0, y: 0, z: 0 },
};

export const DEFAULT_VERTICAL: VerticalLabel = "none";

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
export function normalizeHorizontal(raw: unknown): HorizontalLabel {
  if (typeof raw !== "string") return DEFAULT_HORIZONTAL;
  const key = raw.trim().toLowerCase();
  const found = HORIZONTAL_LABELS.find((d) => d === key);
  return found ?? DEFAULT_HORIZONTAL;
}

export function normalizeVertical(raw: unknown): VerticalLabel {
  if (typeof raw !== "string") return DEFAULT_VERTICAL;
  const key = raw.trim().toLowerCase();
  const found = VERTICAL_LABELS.find((d) => d === key);
  return found ?? DEFAULT_VERTICAL;
}

export function normalizeDistance(raw: unknown): DistanceLabel {
  if (typeof raw !== "string") return DEFAULT_DISTANCE;
  const key = raw.trim().toLowerCase();
  const found = DISTANCE_LABELS.find((d) => d === key);
  return found ?? DEFAULT_DISTANCE;
}

export interface Movement {
  horizontal: HorizontalLabel;
  vertical: VerticalLabel;
  distance: DistanceLabel;
}

/** Pure arithmetic — sum both axis vectors, scaled by the one shared distance. */
export function applyMovement(from: Coords, movement: Movement): Coords {
  const h = HORIZONTAL_VECTORS[movement.horizontal];
  const v = VERTICAL_VECTORS[movement.vertical];
  const u = DISTANCE_UNITS[movement.distance];
  return {
    x: from.x + (h.x + v.x) * u,
    y: from.y + (h.y + v.y) * u,
    z: from.z + (h.z + v.z) * u,
  };
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
export function fallbackMovement(turn: number, action: string): Movement {
  const base = avalanche(seedHash(`travel|${turn}|${action.trim().toLowerCase()}`));
  const horizontal = HORIZONTAL_LABELS[base % HORIZONTAL_LABELS.length];
  const verticalBase = avalanche((base + MIX) >>> 0);
  const vertical = VERTICAL_LABELS[verticalBase % VERTICAL_LABELS.length];
  const distanceBase = avalanche((verticalBase + MIX) >>> 0);
  const distance = DISTANCE_LABELS[distanceBase % DISTANCE_LABELS.length];
  return { horizontal, vertical, distance };
}

export function fallbackCoords(from: Coords, turn: number, action: string): Coords {
  return applyMovement(from, fallbackMovement(turn, action));
}

/* ------------------------------------------------------------------ *
 * Cheap-model refinement — verifyOps.ts's shape
 * ------------------------------------------------------------------ */

/** A short, structured classification — not narration, so a cheap model is plenty. */
export const ESTIMATE_TRAVEL_TEMPERATURE = 0.1;

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
        "Judge the player's movement on TWO INDEPENDENT axes, from the text below.",
        'HORIZONTAL (always required — pick the closest of the four even if the move is mostly vertical): "north", "south", "east", or "west".',
        'VERTICAL (usually "none" — only "up" or "down" when the text genuinely describes gaining or losing elevation, e.g. climbing a hill/tower/stairs or descending into a cellar/pit): "up", "down", or "none".',
        'DISTANCE, shared by both axes — roughly how far: "step" (right next door), "short" (a nearby room or street), "moderate" (across a building or into the next district), "long" (a real journey — riding, sailing, a day\'s walk), or "epic" (an epic trek — days or weeks of travel, a different region entirely).',
        "A move can be both at once — climbing a hillside is horizontal AND vertical; do not discard one axis to report the other.",
        "Infer the axes even when the prose never names a compass direction or an elevation word — read what is described.",
        'Reply with a single JSON object and nothing else — no prose, no code fences: {"horizontal": "...", "vertical": "...", "distance": "..."}.',
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
 * back through `normalizeHorizontal`/`normalizeVertical`/`normalizeDistance`
 * rather than discarding a reply that got the other fields right.
 */
export function parseTravelEstimate(raw: string): Movement | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return null;
  return {
    horizontal: normalizeHorizontal(parsed.horizontal),
    vertical: normalizeVertical(parsed.vertical),
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
export async function estimateTravel(opts: EstimateTravelOptions): Promise<Movement | null> {
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
