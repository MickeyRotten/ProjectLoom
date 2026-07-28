import { describe, it, expect } from "vitest";
import {
  DURATION_LABELS,
  DURATION_MINUTES,
  MAX_ANCHOR_REACH,
  MINUTES_PER_DAY,
  MORNING_ANCHOR,
  advanceClock,
  normalizeDuration,
  normalizeMinutes,
  phaseOf,
} from "./clock";

const at = (h: number, m = 0) => h * 60 + m;

describe("normalizeDuration", () => {
  it("accepts every label on the ladder", () => {
    for (const label of DURATION_LABELS) {
      expect(normalizeDuration(label)).toBe(label);
    }
  });

  it("folds case, spacing and punctuation", () => {
    expect(normalizeDuration("  HalfDay ")).toBe("halfday");
    expect(normalizeDuration("half day")).toBe("halfday");
    expect(normalizeDuration("half-day")).toBe("halfday");
    expect(normalizeDuration("half_day")).toBe("halfday");
  });

  it("falls anything unrecognised to the smallest step", () => {
    expect(normalizeDuration("a fortnight")).toBe("moment");
    expect(normalizeDuration("")).toBe("moment");
    expect(normalizeDuration(undefined)).toBe("moment");
    expect(normalizeDuration(42)).toBe("moment");
    expect(normalizeDuration({ ticks: 100000 })).toBe("moment");
  });
});

describe("normalizeMinutes", () => {
  it("opens a save with no clock at the morning anchor", () => {
    expect(normalizeMinutes(undefined)).toBe(MORNING_ANCHOR);
    expect(normalizeMinutes(NaN)).toBe(MORNING_ANCHOR);
    expect(normalizeMinutes("07:00")).toBe(MORNING_ANCHOR);
  });

  it("wraps a value outside the day into it", () => {
    expect(normalizeMinutes(MINUTES_PER_DAY + 30)).toBe(30);
    expect(normalizeMinutes(-30)).toBe(MINUTES_PER_DAY - 30);
  });
});

describe("phaseOf", () => {
  it("names each band", () => {
    expect(phaseOf(at(2))).toBe("small hours");
    expect(phaseOf(at(5))).toBe("dawn");
    expect(phaseOf(at(9))).toBe("morning");
    expect(phaseOf(at(12))).toBe("midday");
    expect(phaseOf(at(15))).toBe("afternoon");
    expect(phaseOf(at(18, 30))).toBe("dusk");
    expect(phaseOf(at(21))).toBe("evening");
    expect(phaseOf(at(23, 59))).toBe("night");
  });

  it("puts midnight in the small hours, not the previous evening", () => {
    expect(phaseOf(0)).toBe("small hours");
  });
});

describe("advanceClock — the ladder", () => {
  it("adds the mapped minutes", () => {
    expect(advanceClock(1, at(9), "hour")).toEqual({ day: 1, minutes: at(10), rested: false });
    expect(advanceClock(1, at(9), "scene")).toEqual({ day: 1, minutes: at(9, 20), rested: false });
  });

  it("moves the clock even on the smallest step", () => {
    // The whole point of a non-zero floor: a narrator that only ever picks
    // `moment` still ages the world.
    expect(advanceClock(1, at(9), "moment").minutes).toBe(at(9, 1));
  });

  it("rolls the day exactly once at midnight", () => {
    expect(advanceClock(7, at(23, 30), "hour")).toEqual({
      day: 8,
      minutes: at(0, 30),
      rested: false,
    });
  });

  it("rolls a full day for the `day` label without losing the time", () => {
    expect(advanceClock(7, at(14), "day")).toEqual({ day: 8, minutes: at(14), rested: false });
  });

  it("is monotonic for every label from every hour", () => {
    for (const label of DURATION_LABELS) {
      for (let m = 0; m < MINUTES_PER_DAY; m += 15) {
        const next = advanceClock(3, m, label);
        const before = 3 * MINUTES_PER_DAY + m;
        const after = next.day * MINUTES_PER_DAY + next.minutes;
        expect(after).toBeGreaterThan(before);
      }
    }
  });
});

describe("advanceClock — the night anchor", () => {
  it("wakes at the morning anchor the next day when bed is in the evening", () => {
    expect(advanceClock(37, at(21), "night")).toEqual({
      day: 38,
      minutes: MORNING_ANCHOR,
      rested: true,
    });
  });

  it("wakes the SAME day when bed is in the small hours", () => {
    // Going to bed at three in the morning does not buy you a new day.
    expect(advanceClock(37, at(3), "night")).toEqual({
      day: 37,
      minutes: MORNING_ANCHOR,
      rested: true,
    });
  });

  it("honours the anchor right up to its reach", () => {
    const bed = MORNING_ANCHOR - MAX_ANCHOR_REACH + MINUTES_PER_DAY;
    const res = advanceClock(1, bed % MINUTES_PER_DAY, "night");
    expect(res.rested).toBe(true);
    expect(res.minutes).toBe(MORNING_ANCHOR);
  });

  it("clamps a `night` picked in the morning instead of eating the day", () => {
    const res = advanceClock(1, at(10), "night");
    expect(res.rested).toBe(false);
    expect(res.day).toBe(1);
    expect(res.minutes).toBe(at(10) + DURATION_MINUTES.halfday);
  });

  it("costs a whole night when it is already the anchor", () => {
    // Standing exactly on 07:00 must not resolve to a zero-length sleep.
    const res = advanceClock(1, MORNING_ANCHOR, "night");
    expect(res.minutes).toBeGreaterThan(MORNING_ANCHOR);
  });
});
