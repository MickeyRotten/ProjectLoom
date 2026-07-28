/**
 * The in-world clock.
 *
 * `day` used to be a field the NARRATOR wrote (`LoomBlock.day`, straight into
 * `applyDeltas`), and nothing validated it: it could freeze for sixty turns,
 * jump three at once, or run backwards. Now the narrator emits a DURATION — how
 * long the turn took — and the client owns every number. Day becomes
 * arithmetic, monotonic and system-owned, which is what makes it safe for the
 * journal to hang its boundary on.
 *
 * Two rules make the model's half easy:
 *  - it picks from a LADDER of labels, never a number. An unrecognised label
 *    falls to the smallest one, so `ticks: 100000` is unrepresentable rather
 *    than caught — the same "sanitize at read" discipline as `normalizeDice`
 *    and `normalizeItemQuantity`, moved into the type.
 *  - it is never told the time of day as a clock face, only as a PHASE
 *    ("afternoon"). A model handed 14:30 writes "at half past two" into the
 *    prose, which leaks an exact time to the player and implies clocks exist.
 *
 * `minutes` (minutes since midnight) is internal: it is never rendered and
 * never reaches the prompt.
 *
 * Pure + tested — the monotonic invariant is the whole feature's foundation.
 */

export type DurationLabel =
  | "moment"
  | "brief"
  | "scene"
  | "hour"
  | "hours"
  | "halfday"
  | "day"
  | "night";

export const MINUTES_PER_DAY = 1440;

/**
 * The morning the `night` label wakes you at. An anchor, not an offset: bed at
 * 21:00 plus a fixed eight hours wakes you at 05:00, bed at 02:00 plus eight
 * wakes you at 10:00, and the fiction says "you wake at dawn" in both cases.
 */
export const MORNING_ANCHOR = 7 * 60;

/**
 * How far `night` may reach. Picked at ten in the morning the anchor is 21
 * hours away — the label was wrong, and honouring it would silently eat a day.
 * Past this the rest is served as an ordinary long duration instead.
 */
export const MAX_ANCHOR_REACH = 14 * 60;

/**
 * The ladder, in minutes. `night` is absent on purpose: it anchors rather than
 * adds, so it has no fixed length (see `advanceClock`).
 *
 * `moment` is deliberately non-zero. Every turn must move the clock, or a
 * narrator that keeps picking the smallest label freezes time forever.
 */
export const DURATION_MINUTES: Record<Exclude<DurationLabel, "night">, number> = {
  moment: 1,
  brief: 5,
  scene: 20,
  hour: 60,
  hours: 240,
  halfday: 480,
  day: MINUTES_PER_DAY,
};

export const DURATION_LABELS: DurationLabel[] = [
  "moment",
  "brief",
  "scene",
  "hour",
  "hours",
  "halfday",
  "day",
  "night",
];

/** The smallest step — also the fallback for anything unreadable. */
export const DEFAULT_DURATION: DurationLabel = "moment";

/**
 * Time of day as the player and the narrator both see it. Eight bands is plenty
 * of resolution for the things it is actually used for: "evening" is enough to
 * know the shops are shut.
 */
export type Phase =
  | "small hours"
  | "dawn"
  | "morning"
  | "midday"
  | "afternoon"
  | "dusk"
  | "evening"
  | "night";

/** Band starts, in minutes since midnight, ascending. */
const PHASE_BANDS: { from: number; phase: Phase }[] = [
  { from: 0, phase: "small hours" },
  { from: 5 * 60, phase: "dawn" },
  { from: 7 * 60, phase: "morning" },
  { from: 11 * 60, phase: "midday" },
  { from: 14 * 60, phase: "afternoon" },
  { from: 18 * 60, phase: "dusk" },
  { from: 20 * 60, phase: "evening" },
  { from: 22 * 60, phase: "night" },
];

/** Anything the model wrote → a label the clock can use. Unknown → `moment`. */
export function normalizeDuration(raw: unknown): DurationLabel {
  if (typeof raw !== "string") return DEFAULT_DURATION;
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const found = DURATION_LABELS.find((l) => l === key);
  return found ?? DEFAULT_DURATION;
}

/**
 * A stored `minutes` onto the legal range. Saves written before the clock
 * existed have no value at all and open at the morning anchor; a garbage one
 * must never reach the phase bands.
 */
export function normalizeMinutes(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return MORNING_ANCHOR;
  const m = Math.floor(raw) % MINUTES_PER_DAY;
  return m < 0 ? m + MINUTES_PER_DAY : m;
}

export function phaseOf(minutes: number): Phase {
  const m = normalizeMinutes(minutes);
  let phase: Phase = PHASE_BANDS[0].phase;
  for (const band of PHASE_BANDS) {
    if (m >= band.from) phase = band.phase;
  }
  return phase;
}

export interface ClockAdvance {
  day: number;
  minutes: number;
  /**
   * The turn was a night's sleep that landed on the morning anchor — the signal
   * the journal hangs its boundary on. False when `night` had to be clamped,
   * because that label was almost certainly a mistake.
   */
  rested: boolean;
}

/**
 * Move the clock forward by one turn's duration. ALWAYS forward: every path
 * here adds a positive number of minutes, which is the invariant that lets the
 * rest of the app trust `day`.
 */
export function advanceClock(
  day: number,
  minutes: number,
  label: DurationLabel,
): ClockAdvance {
  const now = normalizeMinutes(minutes);
  let delta: number;
  let rested = false;

  if (label === "night") {
    // Distance to the NEXT anchor. Exactly 0 means we are standing on it, and
    // sleeping must still cost a night rather than nothing.
    const reach = (MORNING_ANCHOR - now + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
    if (reach > MAX_ANCHOR_REACH) {
      delta = DURATION_MINUTES.halfday;
    } else {
      delta = reach;
      rested = true;
    }
  } else {
    delta = DURATION_MINUTES[label];
  }

  const total = now + delta;
  return {
    day: day + Math.floor(total / MINUTES_PER_DAY),
    minutes: total % MINUTES_PER_DAY,
    rested,
  };
}
