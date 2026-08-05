import { describe, it, expect } from "vitest";
import type { Front } from "../types";
import {
  MAX_CLOCK,
  MIN_CLOCK,
  clockFace,
  formatFrontLines,
  formatLoomingBlock,
  liveFronts,
  nextStep,
  normalizeFront,
  openFronts,
  restFronts,
  tickFront,
  tickNeglect,
} from "./fronts";

const front = (patch: Partial<Front> = {}): Front =>
  normalizeFront({
    id: "flood",
    label: "the mine floods",
    steps: ["water in the sump", "the lower gallery is cut off", "the shaft goes"],
    ticks: 0,
    lastTickDay: 1,
    status: "open",
    ...patch,
  });

describe("normalizeFront", () => {
  it("pins ticks inside the clock rather than clamping garbage in", () => {
    expect(front({ ticks: 99 }).ticks).toBe(3);
    expect(front({ ticks: -4 }).ticks).toBe(0);
    expect(normalizeFront({ ticks: NaN }).ticks).toBe(0);
  });

  it("drops steps past the clock ceiling", () => {
    const long = normalizeFront({ steps: Array.from({ length: 20 }, (_, i) => `s${i}`) });
    expect(long.steps).toHaveLength(MAX_CLOCK);
  });

  it("gives a front with no clock the shortest one it could have", () => {
    // A front that can never fire is not a front; it just stops existing quietly.
    expect(normalizeFront({ steps: [] }).steps.length).toBe(MIN_CLOCK);
    expect(normalizeFront({ steps: ["only one"] }).steps.length).toBe(MIN_CLOCK);
  });

  it("drops blank and non-string steps", () => {
    const f = normalizeFront({ steps: ["a", "  ", null, 7, "b"] as unknown as string[] });
    expect(f.steps).toEqual(["a", "b"]);
  });

  it("never reads an unknown status as anything but open", () => {
    expect(normalizeFront({ status: "exploded" as Front["status"] }).status).toBe("open");
    expect(normalizeFront({ status: "retired" }).status).toBe("retired");
  });
});

describe("clockFace / nextStep", () => {
  it("draws the clock as filled and empty pips", () => {
    expect(clockFace(front({ ticks: 0 }))).toBe("○○○");
    expect(clockFace(front({ ticks: 2 }))).toBe("●●○");
    expect(clockFace(front({ ticks: 3 }))).toBe("●●●");
  });

  it("shows the step about to be reached, and never runs off the end", () => {
    expect(nextStep(front({ ticks: 0 }))).toBe("water in the sump");
    expect(nextStep(front({ ticks: 1 }))).toBe("the lower gallery is cut off");
    expect(nextStep(front({ ticks: 3 }))).toBe("the shaft goes");
  });
});

describe("tickFront", () => {
  it("advances one step and stamps the day", () => {
    const { fronts, ticked, fired } = tickFront([front()], "flood", 5);
    expect(fronts[0].ticks).toBe(1);
    expect(fronts[0].lastTickDay).toBe(5);
    expect(ticked).toEqual(["the mine floods"]);
    expect(fired).toEqual([]);
  });

  it("fires at the end of the clock", () => {
    const { fronts, fired } = tickFront([front({ ticks: 2 })], "flood", 5);
    expect(fronts[0].status).toBe("fired");
    expect(fired).toEqual(["the mine floods"]);
  });

  it("is reference-stable for an id that names nothing, or a front already spent", () => {
    const fronts = [front({ status: "fired" })];
    expect(tickFront(fronts, "flood", 5).fronts).toBe(fronts);
    expect(tickFront([front()], "landslide", 5).fronts[0].ticks).toBe(0);
  });
});

describe("tickNeglect", () => {
  it("ticks a front nobody has touched for long enough", () => {
    const { fronts, ticked } = tickNeglect([front({ lastTickDay: 1 })], 4, 2);
    expect(fronts[0].ticks).toBe(1);
    expect(ticked).toEqual(["the mine floods"]);
  });

  it("ticks ONCE however many days have piled up — a clock, not interest", () => {
    const { fronts } = tickNeglect([front({ lastTickDay: 1 })], 400, 2);
    expect(fronts[0].ticks).toBe(1);
  });

  it("leaves a front touched recently alone", () => {
    const fronts = [front({ lastTickDay: 4 })];
    expect(tickNeglect(fronts, 5, 2).fronts).toBe(fronts);
  });

  it("is switched off entirely at 0 days", () => {
    const fronts = [front({ lastTickDay: -50 })];
    expect(tickNeglect(fronts, 100, 0).fronts).toBe(fronts);
  });

  it("skips fronts that are not open", () => {
    const fronts = [front({ status: "retired", lastTickDay: 1 })];
    expect(tickNeglect(fronts, 90, 1).fronts).toBe(fronts);
  });
});

describe("restFronts", () => {
  it("re-anchors the clocks without ticking anything — the interlude's exit", () => {
    const out = restFronts([front({ lastTickDay: 1 })], 9);
    expect(out[0].lastTickDay).toBe(9);
    expect(out[0].ticks).toBe(0);
    // …so the suspended days can't arrive at once as a neglect burst.
    expect(tickNeglect(out, 9, 2).fronts).toBe(out);
  });

  it("is reference-stable when nothing had to move", () => {
    const fronts = [front({ lastTickDay: 9 })];
    expect(restFronts(fronts, 9)).toBe(fronts);
  });
});

describe("openFronts / liveFronts", () => {
  it("opens a template on the day it starts", () => {
    const [f] = openFronts([{ id: "a", label: "a", steps: ["x", "y"] }], 7);
    expect(f).toMatchObject({ ticks: 0, lastTickDay: 7, status: "open" });
  });

  it("counts only the fronts that can still fire", () => {
    const arc = {
      fronts: [front(), front({ id: "b", status: "fired" }), front({ id: "c", status: "retired" })],
    };
    expect(liveFronts(arc as never)).toHaveLength(1);
    expect(liveFronts(undefined)).toEqual([]);
  });
});

describe("the prompt lines", () => {
  it("shows the clock and the NEXT step only — the rest is spoiler", () => {
    const [line] = formatFrontLines([front({ ticks: 1 })]);
    expect(line).toContain("the mine floods");
    expect(line).toContain("●○○");
    expect(line).toContain("next: the lower gallery is cut off");
    expect(line).not.toContain("the shaft goes");
  });

  it("writes an arrival that happens in this beat rather than looming further", () => {
    const block = formatLoomingBlock(front({ ticks: 3, status: "fired" }));
    expect(block).toContain("THE FRONT ARRIVES");
    expect(block).toContain("the shaft goes");
    expect(block).toContain("authoritative");
  });
});
