import { describe, it, expect } from "vitest";
import type { Front } from "../types";
import {
  MAX_CLOCK,
  MIN_CLOCK,
  clockFace,
  formatFrontLine,
  formatLoomingBlock,
  liveFront,
  nextStep,
  normalizeFront,
  openFront,
  restFront,
  tickFront,
  tickNeglect,
} from "./fronts";

const front = (patch: Partial<Front> = {}): Front =>
  normalizeFront({
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
    const { front: out, ticked, fired } = tickFront(front(), 5);
    expect(out?.ticks).toBe(1);
    expect(out?.lastTickDay).toBe(5);
    expect(ticked).toBe("the mine floods");
    expect(fired).toBeNull();
  });

  it("fires at the end of the clock", () => {
    const { front: out, fired } = tickFront(front({ ticks: 2 }), 5);
    expect(out?.status).toBe("fired");
    expect(fired).toBe("the mine floods");
  });

  it("is reference-stable with no front, or one already spent", () => {
    const spent = front({ status: "fired" });
    expect(tickFront(spent, 5).front).toBe(spent);
    expect(tickFront(undefined, 5).front).toBeUndefined();
  });
});

describe("tickNeglect", () => {
  it("ticks a front nobody has touched for long enough", () => {
    const { front: out, ticked } = tickNeglect(front({ lastTickDay: 1 }), 4, 2);
    expect(out?.ticks).toBe(1);
    expect(ticked).toBe("the mine floods");
  });

  it("ticks ONCE however many days have piled up — a clock, not interest", () => {
    expect(tickNeglect(front({ lastTickDay: 1 }), 400, 2).front?.ticks).toBe(1);
  });

  it("leaves a front touched recently alone", () => {
    const f = front({ lastTickDay: 4 });
    expect(tickNeglect(f, 5, 2).front).toBe(f);
  });

  it("is switched off entirely at 0 days", () => {
    const f = front({ lastTickDay: -50 });
    expect(tickNeglect(f, 100, 0).front).toBe(f);
  });

  it("skips a front that is not open", () => {
    const f = front({ status: "retired", lastTickDay: 1 });
    expect(tickNeglect(f, 90, 1).front).toBe(f);
  });
});

describe("restFront", () => {
  it("re-anchors the clock without ticking it — the interlude's exit", () => {
    const out = restFront(front({ lastTickDay: 1 }), 9)!;
    expect(out.lastTickDay).toBe(9);
    expect(out.ticks).toBe(0);
    // …so the suspended days can't arrive at once as a neglect burst.
    expect(tickNeglect(out, 9, 2).front).toBe(out);
  });

  it("is reference-stable when nothing had to move", () => {
    const f = front({ lastTickDay: 9 });
    expect(restFront(f, 9)).toBe(f);
    expect(restFront(undefined, 9)).toBeUndefined();
  });
});

describe("openFront / liveFront", () => {
  it("opens a template on the day it starts", () => {
    expect(openFront({ label: "a", steps: ["x", "y"] }, 7)).toMatchObject({
      ticks: 0,
      lastTickDay: 7,
      status: "open",
    });
    expect(openFront(undefined, 7)).toBeUndefined();
  });

  it("is the front only while it can still fire", () => {
    expect(liveFront({ front: front() } as never)).toBeDefined();
    expect(liveFront({ front: front({ status: "fired" }) } as never)).toBeUndefined();
    expect(liveFront({ front: front({ status: "retired" }) } as never)).toBeUndefined();
    expect(liveFront(undefined)).toBeUndefined();
  });
});

describe("the prompt lines", () => {
  it("shows the clock and the NEXT step only — the rest is spoiler", () => {
    const line = formatFrontLine(front({ ticks: 1 }));
    expect(line).toContain("the mine floods");
    expect(line).toContain("●○○");
    expect(line).toContain("next: the lower gallery is cut off");
    expect(line).not.toContain("the shaft goes");
  });

  it("is blank with no front, so the block above it stays empty", () => {
    expect(formatFrontLine(undefined)).toBe("");
  });

  it("writes an arrival that happens in this beat rather than looming further", () => {
    const block = formatLoomingBlock(front({ ticks: 3, status: "fired" }));
    expect(block).toContain("THE FRONT ARRIVES");
    expect(block).toContain("the shaft goes");
    expect(block).toContain("authoritative");
  });
});
