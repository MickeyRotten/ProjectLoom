import { describe, it, expect } from "vitest";
import type { Arc, ArcTemplate } from "../types";
import { newGame, defaultSettings } from "./defaults";
import {
  buildArcMessages,
  bumpEpoch,
  frontFired,
  handOff,
  hasArc,
  interludeOver,
  interludeTurnsSoFar,
  normalizeArc,
  normalizeTemplate,
  openArc,
  parseArc,
  resumeArc,
  runningArc,
  toInterlude,
} from "./arc";

const template: ArcTemplate = {
  question: "the consortium is buying the valley",
  front: { label: "the mine floods", steps: ["a", "b"] },
};

const opened = (day = 1) => openArc(template, "arc-1", 0, day);

describe("normalizeTemplate", () => {
  it("keeps the authored shape", () => {
    const clean = normalizeTemplate(template);
    expect(clean.question).toBe("the consortium is buying the valley");
    expect(clean.front?.steps).toEqual(["a", "b"]);
    // A template carries no clock: ticks and status belong to the instance.
    expect(clean.front).toEqual({ label: "the mine floods", steps: ["a", "b"] });
  });

  it("folds the old fronts[] + spine pair onto the one front", () => {
    // Every arc stored before the collapse. The spine is the front that ended
    // the chapter, so it is the one that survives.
    const legacy = normalizeTemplate({
      question: "q",
      spine: "warden",
      fronts: [
        { id: "flood", label: "the mine floods", steps: ["a", "b"] },
        { id: "warden", label: "the warden turns", steps: ["c", "d"] },
      ],
    } as unknown as Partial<ArcTemplate>);
    expect(legacy.front?.label).toBe("the warden turns");

    // A spine naming nothing falls back to the first, rather than to no front
    // at all — an arc that can never complete is worse than a wrong one.
    const orphan = normalizeTemplate({
      question: "q",
      spine: "nobody",
      fronts: [{ id: "flood", label: "the mine floods", steps: ["a", "b"] }],
    } as unknown as Partial<ArcTemplate>);
    expect(orphan.front?.label).toBe("the mine floods");
  });

  it("reads a blank template as no arc at all", () => {
    expect(hasArc(normalizeTemplate(undefined))).toBe(false);
    expect(hasArc(normalizeTemplate({ question: "  " }))).toBe(false);
    expect(hasArc(normalizeTemplate(template))).toBe(true);
  });
});

describe("normalizeArc", () => {
  it("sanitizes an instance at read", () => {
    const arc = normalizeArc({
      id: "",
      question: " q ",
      front: { label: "l", steps: ["a", "b"], ticks: 99 } as Arc["front"],
      epoch: -3,
      status: "melted" as Arc["status"],
    });
    expect(arc.id).toBe("arc-1");
    expect(arc.question).toBe("q");
    expect(arc.epoch).toBe(0);
    expect(arc.status).toBe("running");
    expect(arc.front?.ticks).toBe(2);
  });

  it("keeps a stored instance's ticks through the fronts[] fold", () => {
    const arc = normalizeArc({
      id: "arc-1",
      question: "q",
      spine: "flood",
      fronts: [{ id: "flood", label: "l", steps: ["a", "b", "c"], ticks: 2, lastTickDay: 4, status: "open" }],
    } as unknown as Partial<Arc>);
    expect(arc.front?.ticks).toBe(2);
    expect(arc.front?.lastTickDay).toBe(4);
  });

  it("leaves an arc with no front frontless rather than inventing one", () => {
    expect(normalizeArc({ id: "a", question: "q" }).front).toBeUndefined();
  });
});

describe("the arc's life", () => {
  it("opens the front on the day it starts", () => {
    const arc = opened(4);
    expect(arc.status).toBe("running");
    expect(arc.front?.lastTickDay).toBe(4);
    expect(arc.front?.ticks).toBe(0);
  });

  it("resolves when the front fires", () => {
    const arc = opened();
    expect(frontFired(arc)).toBe(false);
    expect(frontFired({ ...arc, front: { ...arc.front!, status: "fired" } })).toBe(true);
    // Retired is spent, not arriving: the interlude has already begun.
    expect(frontFired({ ...arc, front: { ...arc.front!, status: "retired" } })).toBe(false);
  });

  it("counts an interlude from the turn it began", () => {
    const arc = toInterlude(opened(), 30);
    expect(arc.status).toBe("interlude");
    expect(interludeTurnsSoFar(arc, 34)).toBe(4);
    expect(interludeOver(arc, 34, 6)).toBe(false);
    expect(interludeOver(arc, 36, 6)).toBe(true);
    // Only an interlude has one to be over.
    expect(interludeOver(opened(), 999, 6)).toBe(false);
  });

  it("re-anchors the clock when an interlude resumes without a handoff", () => {
    const arc = toInterlude(opened(1), 10);
    const back = resumeArc(arc, 9);
    expect(back.status).toBe("running");
    expect(back.interludeFrom).toBeUndefined();
    expect(back.front?.lastTickDay).toBe(9);
  });

  it("bumps the epoch, which is what makes every area under it stale", () => {
    expect(bumpEpoch(opened()).epoch).toBe(1);
  });
});

describe("handOff", () => {
  it("archives the closed arc rather than deleting it", () => {
    const arcs = handOff([opened()], template, "arc-2", 40, 6);
    expect(arcs).toHaveLength(2);
    expect(arcs[0].status).toBe("done");
    expect(arcs[1].id).toBe("arc-2");
    expect(arcs[1].openedTurn).toBe(40);
    expect(arcs[1].front?.lastTickDay).toBe(6);
  });

  it("drops the staged template off the arc it closes", () => {
    const staged: Arc = { ...opened(), staged: template };
    const arcs = handOff([staged], template, "arc-2", 1, 1);
    expect(arcs[0].staged).toBeUndefined();
  });

  it("just opens one when there is nothing running", () => {
    expect(handOff([], template, "arc-1", 1, 1)).toHaveLength(1);
  });

  it("runningArc skips the finished ones", () => {
    const arcs = handOff([opened()], template, "arc-2", 1, 1);
    expect(runningArc(arcs)?.id).toBe("arc-2");
    expect(runningArc([])).toBeUndefined();
  });
});

describe("parseArc", () => {
  it("reads a fenced, chatty reply", () => {
    const arc = parseArc(
      'Sure!\n```json\n{ "question": "who owns the water", "front": { "label": "the well dries", "steps": ["x", "y"] } }\n```',
    );
    expect(arc?.question).toBe("who owns the water");
    expect(arc?.front?.label).toBe("the well dries");
  });

  it("still reads a model that reaches for the old plural", () => {
    const arc = parseArc('{ "question": "q", "fronts": [ { "label": "the well dries", "steps": ["x"] } ] }');
    expect(arc?.front?.label).toBe("the well dries");
  });

  it("returns null when there is nothing usable, so the arc is left alone", () => {
    expect(parseArc("no json here")).toBeNull();
    expect(parseArc("{}")).toBeNull();
    expect(parseArc('{ "question": "   " }')).toBeNull();
  });
});

describe("buildArcMessages", () => {
  it("reads the journal and the closed chapter, never the raw beats", () => {
    const game = {
      ...newGame(),
      journal: [
        { id: "j1", day: 1, fromTurn: 1, throughTurn: 4, lines: [{ text: "Crossed the marsh.", source: "system" as const }] },
      ],
      messages: [
        { id: "m1", role: "narrator" as const, content: "A VERY DISTINCTIVE BEAT", turn: 1 },
      ],
    };
    const closing = { ...opened(), question: "the consortium is buying the valley" };
    const text = buildArcMessages(defaultSettings(), game, game.characters, closing)
      .map((m) => m.content)
      .join("\n");

    expect(text).toContain("NEXT ARC");
    expect(text).toContain("the consortium is buying the valley");
    expect(text).toContain("Crossed the marsh.");
    expect(text).not.toContain("A VERY DISTINCTIVE BEAT");
  });

  it("asks for exactly the number of steps the player set", () => {
    const settings = { ...defaultSettings(), arcSteps: 7 };
    const text = buildArcMessages(settings, newGame(), [], undefined)
      .map((m) => m.content)
      .join("\n");
    expect(text).toContain("EXACTLY 7 of them");
  });

  it("injects the player's guidance, and nothing at all when it is blank", () => {
    const game = newGame();
    const blank = buildArcMessages(defaultSettings(), game, [], undefined);
    const guided = buildArcMessages(
      { ...defaultSettings(), arcGuidance: "  keep it inside the city  " },
      game,
      [],
      undefined,
    );
    expect(guided).toHaveLength(blank.length + 1);
    expect(guided.map((m) => m.content).join("\n")).toContain("keep it inside the city");
  });

  it("works with no arc closing — the first handoff of a campaign", () => {
    const messages = buildArcMessages(defaultSettings(), newGame(), [], undefined);
    expect(messages[messages.length - 1].role).toBe("user");
  });
});
