import { describe, it, expect } from "vitest";
import type { StoryPromise } from "../types";
import {
  MAX_PROMISES,
  PROMISES_SHOWN,
  agePromises,
  applyPromises,
  formatOptionNote,
  formatPromisesBlock,
  normalizePromises,
  reconcilePromises,
} from "./promises";

const p = (text: string, plantedTurn = 1): StoryPromise => ({
  id: `promise-${text}`,
  text,
  plantedTurn,
});

describe("normalizePromises", () => {
  it("drops blanks, junk rows and duplicate spellings", () => {
    const out = normalizePromises([
      { text: "the tremor in the walls", plantedTurn: 3 },
      { text: "  The Tremor In The Walls  " },
      { text: "" },
      null,
      "a string",
      { plantedTurn: 9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("the tremor in the walls");
    expect(out[0].plantedTurn).toBe(3);
  });

  it("reads anything that is not a list as nothing", () => {
    expect(normalizePromises(undefined)).toEqual([]);
    expect(normalizePromises({ text: "x" })).toEqual([]);
  });
});

describe("applyPromises", () => {
  it("plants with this turn's stamp", () => {
    const out = applyPromises([], [{ op: "add", text: "the tremor" }], 12);
    expect(out[0]).toMatchObject({ text: "the tremor", plantedTurn: 12 });
  });

  it("keeps the ORIGINAL turn when the narrator restates a promise", () => {
    const out = applyPromises([p("the tremor", 3)], [{ op: "add", text: "The Tremor" }], 20);
    // Otherwise a narrator repeating itself keeps a promise forever young and it
    // can never age into an escalation.
    expect(out[0].plantedTurn).toBe(3);
    expect(out).toHaveLength(1);
  });

  it("closes one off by slug, however it is spelled the second time", () => {
    const out = applyPromises([p("the tremor")], [{ op: "remove", text: "  the TREMOR " }], 5);
    expect(out).toEqual([]);
  });

  it("is reference-stable when nothing changed", () => {
    const held = [p("the tremor")];
    expect(applyPromises(held, undefined, 4)).toBe(held);
    expect(applyPromises(held, [], 4)).toBe(held);
    expect(applyPromises(held, [{ op: "add", text: "the tremor" }], 4)).toBe(held);
    expect(applyPromises(held, [{ op: "remove", text: "something else" }], 4)).toBe(held);
  });

  it("never grows past the cap", () => {
    let held: StoryPromise[] = [];
    for (let i = 0; i < MAX_PROMISES + 5; i++) {
      held = applyPromises(held, [{ op: "add", text: `promise ${i}` }], i);
    }
    expect(held).toHaveLength(MAX_PROMISES);
    expect(held[held.length - 1].text).toBe(`promise ${MAX_PROMISES + 4}`);
  });
});

describe("agePromises", () => {
  it("drops one at TWICE the escalation age, not before", () => {
    const held = [p("old", 1)];
    expect(agePromises(held, 16, 8)).toBe(held);
    expect(agePromises(held, 18, 8)).toEqual([]);
  });

  it("does nothing at all when ageing is switched off", () => {
    const held = [p("old", 1)];
    expect(agePromises(held, 9999, 0)).toBe(held);
  });
});

describe("reconcilePromises", () => {
  it("drops the ops that change nothing", () => {
    const out = reconcilePromises(
      [p("the tremor")],
      [
        { op: "add", text: "the tremor" },
        { op: "remove", text: "never promised" },
      ],
    );
    expect(out).toEqual([]);
  });

  it("keeps the ops that do, and tracks held-ness as the block runs", () => {
    const out = reconcilePromises(
      [],
      [
        { op: "add", text: "the tremor" },
        { op: "add", text: "the tremor" },
        { op: "remove", text: "the tremor" },
      ],
    );
    expect(out).toEqual([
      { op: "add", text: "the tremor" },
      { op: "remove", text: "the tremor" },
    ]);
  });

  it("is reference-stable when every op is real", () => {
    const deltas = [{ op: "add" as const, text: "new thing" }];
    expect(reconcilePromises([], deltas)).toBe(deltas);
    expect(reconcilePromises([], undefined)).toBeUndefined();
  });
});

describe("formatPromisesBlock", () => {
  it("says nothing when nothing is outstanding", () => {
    expect(formatPromisesBlock([], 10, 8)).toBe("");
  });

  it("shows the newest few, newest first, with the age spelled out", () => {
    const held = [p("first", 1), p("second", 2), p("third", 3), p("fourth", 4)];
    const block = formatPromisesBlock(held, 5, 8);
    expect(block).toContain("PROMISES");
    expect(block).toContain("fourth (1 turn ago)");
    expect(block.indexOf("fourth")).toBeLessThan(block.indexOf("third"));
    expect(block).not.toContain("first");
    expect(block.split("\n")).toHaveLength(PROMISES_SHOWN + 1);
  });

  it("escalates once a promise is overdue", () => {
    expect(formatPromisesBlock([p("the tremor", 1)], 4, 8)).not.toContain("let it go");
    expect(formatPromisesBlock([p("the tremor", 1)], 9, 8)).toContain("pay it off or let it go");
  });
});

describe("formatOptionNote", () => {
  it("hands the note back as direction", () => {
    expect(formatOptionNote("the stair takes weight it shouldn't")).toContain("YOU PLANNED THIS");
  });

  it("is blank for a typed action, which carries no note", () => {
    expect(formatOptionNote(undefined)).toBe("");
    expect(formatOptionNote("   ")).toBe("");
  });
});
