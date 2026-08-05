import { describe, it, expect } from "vitest";
import type { Arc, ArcTemplate } from "../types";
import { newGame, defaultSettings } from "./defaults";
import {
  MAX_FRONTS,
  buildArcMessages,
  bumpEpoch,
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
  spineFired,
  toInterlude,
} from "./arc";

const template: ArcTemplate = {
  question: "the consortium is buying the valley",
  spine: "flood",
  fronts: [
    { id: "flood", label: "the mine floods", steps: ["a", "b"] },
    { id: "warden", label: "the warden turns", steps: ["c", "d", "e"] },
  ],
};

const opened = (day = 1) => openArc(template, "arc-1", 0, day);

describe("normalizeTemplate", () => {
  it("keeps the authored shape and caps the fronts", () => {
    const many = normalizeTemplate({
      question: "q",
      spine: "f0",
      fronts: Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, label: `l${i}`, steps: ["x", "y"] })),
    });
    expect(many.fronts).toHaveLength(MAX_FRONTS);
  });

  it("falls a spine naming nothing back to the first front", () => {
    // An arc that can never complete is worse than one that ends on the wrong beat.
    expect(normalizeTemplate({ ...template, spine: "nobody" }).spine).toBe("flood");
    expect(normalizeTemplate({ fronts: [] }).spine).toBe("");
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
      spine: "flood",
      fronts: [{ id: "flood", label: "l", steps: ["a", "b"], ticks: 99 }] as Arc["fronts"],
      epoch: -3,
      status: "melted" as Arc["status"],
    });
    expect(arc.id).toBe("arc-1");
    expect(arc.question).toBe("q");
    expect(arc.epoch).toBe(0);
    expect(arc.status).toBe("running");
    expect(arc.fronts[0].ticks).toBe(2);
  });
});

describe("the arc's life", () => {
  it("opens every front on the day it starts", () => {
    const arc = opened(4);
    expect(arc.status).toBe("running");
    expect(arc.fronts.every((f) => f.lastTickDay === 4 && f.ticks === 0)).toBe(true);
  });

  it("resolves when the SPINE fires, and not when anything else does", () => {
    const arc = opened();
    const other = {
      ...arc,
      fronts: arc.fronts.map((f) => (f.id === "warden" ? { ...f, status: "fired" as const } : f)),
    };
    expect(spineFired(other)).toBe(false);
    const spine = {
      ...arc,
      fronts: arc.fronts.map((f) => (f.id === "flood" ? { ...f, status: "fired" as const } : f)),
    };
    expect(spineFired(spine)).toBe(true);
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

  it("re-anchors every clock when an interlude resumes without a handoff", () => {
    const arc = toInterlude(opened(1), 10);
    const back = resumeArc(arc, 9);
    expect(back.status).toBe("running");
    expect(back.interludeFrom).toBeUndefined();
    expect(back.fronts.every((f) => f.lastTickDay === 9)).toBe(true);
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
    expect(arcs[1].fronts.every((f) => f.lastTickDay === 6)).toBe(true);
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
      'Sure!\n```json\n{ "question": "who owns the water", "fronts": [ { "id": "a", "label": "the well dries", "steps": ["x", "y"] } ], "spine": "a" }\n```',
    );
    expect(arc?.question).toBe("who owns the water");
    expect(arc?.spine).toBe("a");
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

  it("works with no arc closing — the first handoff of a campaign", () => {
    const messages = buildArcMessages(defaultSettings(), newGame(), [], undefined);
    expect(messages[messages.length - 1].role).toBe("user");
  });
});
