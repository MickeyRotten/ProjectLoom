import { describe, it, expect } from "vitest";
import type { AreaCard, GameState, Settings } from "../types";
import { defaultSettings, newGame } from "./defaults";
import { openArc, runningArc, toInterlude } from "./arc";
import { anchorClocks, closeInterlude, normalizeForesight, reckonTurn, seedArcs } from "./foresight";

const template = {
  question: "the consortium is buying the valley",
  spine: "flood",
  fronts: [
    { id: "flood", label: "the mine floods", steps: ["a", "b"] },
    { id: "warden", label: "the warden turns", steps: ["c", "d"] },
  ],
};

const area = (patch: Partial<AreaCard> = {}): AreaCard => ({
  key: "murkwood",
  name: "Murkwood",
  arcId: "arc-1",
  epoch: 0,
  version: 1,
  coord: { x: 0, y: 0 },
  neighbours: [],
  texture: "wet",
  threats: [],
  front: "flood",
  rooms: {},
  ...patch,
});

function game(patch: Partial<GameState> = {}): GameState {
  return {
    ...newGame(),
    location: "Forest Entrance",
    areaKey: "murkwood",
    areas: { murkwood: area() },
    arcs: [openArc(template, "arc-1", 0, 1)],
    ...patch,
  };
}

const settings = (patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  ...patch,
});

const run = (g: GameState, patch: Partial<Parameters<typeof reckonTurn>[0]> = {}) =>
  reckonTurn({
    game: g,
    settings: settings(),
    turn: 5,
    day: 1,
    location: g.location,
    block: null,
    outcome: null,
    ...patch,
  });

describe("the room → area join", () => {
  it("resolves the area off the room lists and records the visit", () => {
    const out = run(game());
    expect(out.areaKey).toBe("murkwood");
    expect(out.areas!.murkwood.rooms["forest-entrance"].visited).toBe(true);
  });

  it("opens a stub for a region the narrator has just named", () => {
    const out = run(game({ areas: {}, areaKey: null, location: "Market Square" }), {
      block: { area: "Rodstroke" },
      location: "Market Square",
    });
    expect(out.areaKey).toBe("rodstroke");
    expect(out.areas!.rodstroke.name).toBe("Rodstroke");
    expect(out.areas!.rodstroke.rooms["market-square"].visited).toBe(true);
  });

  it("keeps the player where they were when a block names no area", () => {
    const out = run(game({ location: "Somewhere Unlisted" }), { location: "Somewhere Unlisted" });
    expect(out.areaKey).toBe("murkwood");
  });
});

describe("front ticking", () => {
  it("ticks the front this region serves on a COST", () => {
    const out = run(game(), { outcome: "cost" });
    expect(runningArc(out.arcs)?.fronts[0].ticks).toBe(1);
    expect(out.reckoning?.frontTicked).toBe("the mine floods");
  });

  it("leaves everything alone on a STRONG", () => {
    const g = game();
    expect(run(g, { outcome: "strong" }).arcs).toBe(g.arcs);
  });

  it("only ticks on MIXED when the table asks for it", () => {
    const g = game();
    expect(run(g, { outcome: "mixed" }).arcs).toBe(g.arcs);
    const harsh = reckonTurn({
      game: g,
      settings: settings({ mixedTicksFront: true }),
      turn: 5,
      day: 1,
      location: g.location,
      block: null,
      outcome: "mixed",
    });
    expect(runningArc(harsh.arcs)?.fronts[0].ticks).toBe(1);
  });

  it("does not tick when the region serves no front", () => {
    const g = game({ areas: { murkwood: area({ front: undefined }) } });
    expect(run(g, { outcome: "cost" }).arcs).toBe(g.arcs);
  });

  it("ticks a neglected front even on a quiet turn", () => {
    const out = run(game(), { day: 9 });
    // Both fronts were last touched on day 1, so both move.
    expect(runningArc(out.arcs)?.fronts.map((f) => f.ticks)).toEqual([1, 1]);
  });

  it("suspends every clock during an interlude", () => {
    const g = game({ arcs: [toInterlude(openArc(template, "arc-1", 0, 1), 3)] });
    expect(run(g, { outcome: "cost", day: 99 }).arcs).toBe(g.arcs);
  });
});

describe("firing, arrival and the interlude", () => {
  it("fires at the end of the clock and bumps the epoch", () => {
    const g = game();
    const once = run(g, { outcome: "cost" });
    const twice = run({ ...g, arcs: once.arcs }, { outcome: "cost" });
    const arc = runningArc(twice.arcs)!;
    expect(arc.fronts[0].status).toBe("fired");
    expect(arc.epoch).toBe(1);
    expect(twice.reckoning?.frontFired).toBe("the mine floods");
    // Still running: the arrival has to be NARRATED before the story can end on
    // it, and an interlude opens by saying nothing is looming.
    expect(arc.status).toBe("running");
  });

  it("retires the fired front on the NEXT turn, so the arrival block fires once", () => {
    let g = game();
    g = { ...g, arcs: run(g, { outcome: "cost" }).arcs };
    g = { ...g, arcs: run(g, { outcome: "cost" }).arcs };
    expect(runningArc(g.arcs)!.fronts[0].status).toBe("fired");

    const after = run(g);
    const arc = runningArc(after.arcs)!;
    expect(arc.fronts[0].status).toBe("retired");
    // It was the spine, so now the story closes.
    expect(arc.status).toBe("interlude");
    expect(arc.interludeFrom).toBe(5);
  });

  it("does not end the story when a non-spine front is spent", () => {
    const g = game({
      arcs: [
        {
          ...openArc(template, "arc-1", 0, 1),
          fronts: openArc(template, "arc-1", 0, 1).fronts.map((f) =>
            f.id === "warden" ? { ...f, status: "fired" as const, ticks: 2 } : f,
          ),
        },
      ],
    });
    const arc = runningArc(run(g).arcs)!;
    expect(arc.status).toBe("running");
    expect(arc.fronts[1].status).toBe("retired");
  });

  it("applies a staged handoff when the interlude runs out", () => {
    const arc = { ...toInterlude(openArc(template, "arc-1", 0, 1), 1), staged: template };
    const out = run(game({ arcs: [arc] }), { turn: 99 });
    expect(out.arcs).toHaveLength(2);
    expect(out.arcs![0].status).toBe("done");
    expect(runningArc(out.arcs)?.status).toBe("running");
  });

  it("resumes rather than stalling when no handoff was ever staged", () => {
    const arc = toInterlude(openArc(template, "arc-1", 0, 1), 1);
    const out = run(game({ arcs: [arc] }), { turn: 99, day: 40 });
    const back = runningArc(out.arcs)!;
    expect(back.status).toBe("running");
    // …with the clocks re-anchored, so the suspended days don't arrive at once.
    expect(back.fronts.every((f) => f.lastTickDay === 40)).toBe(true);
  });
});

describe("promises", () => {
  it("plants what the block committed to and reports it as a client act", () => {
    const out = run(game(), { block: { promises: [{ op: "add", text: "the tremor" }] } });
    expect(out.promises).toHaveLength(1);
    expect(out.reckoning?.promisesPlanted).toEqual(["the tremor"]);
  });

  it("is reference-stable on a quiet turn", () => {
    const g = game();
    expect(run(g).promises).toBe(g.promises);
  });
});

describe("seedArcs", () => {
  it("opens the scenario's authored arc when the game has none", () => {
    const g = { ...newGame(), scenario: { ...newGame().scenario, arc: template } };
    const arcs = seedArcs(g, 0);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].question).toBe(template.question);
  });

  it("leaves a game that already has one alone, and one with no template", () => {
    const g = game();
    expect(seedArcs(g, 0)).toBe(g.arcs);
    expect(seedArcs(newGame(), 0)).toEqual([]);
  });
});

describe("normalizeForesight / anchorClocks", () => {
  it("is reference-stable on a save with no Foresight in it", () => {
    const g = newGame();
    expect(normalizeForesight(g)).toBe(g);
  });

  it("sanitizes a hand-edited gazetteer at read", () => {
    const g = game({
      areas: {
        murkwood: area({
          rooms: {
            a: { name: "A", coord: { x: 900, y: 0 }, exits: ["ghost"], visited: true, card: null },
          },
        }),
      },
    });
    const out = normalizeForesight(g);
    expect(out.areas!.murkwood.rooms.a.coord.x).toBe(16);
    expect(out.areas!.murkwood.rooms.a.exits).toEqual([]);
  });

  it("moves the clocks forward without ticking anything", () => {
    const g = game();
    const arcs = anchorClocks(g.arcs!, 12);
    expect(arcs[0].fronts.every((f) => f.lastTickDay === 12 && f.ticks === 0)).toBe(true);
    expect(anchorClocks(arcs, 12)).toBe(arcs);
  });
});

describe("closeInterlude", () => {
  it("never leaves the campaign without an arc", () => {
    const arc = toInterlude(openArc(template, "arc-1", 0, 1), 1);
    expect(runningArc(closeInterlude([arc], arc, 20, 3))).toBeDefined();
  });
});
