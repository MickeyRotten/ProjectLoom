import { describe, it, expect } from "vitest";
import type { Arc, ArcTemplate, Note } from "../types";
import { newGame, defaultSettings } from "./defaults";
import {
  arcScanText,
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
  rewriteArc,
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

  it("tells the model to REPLACE the arc it is shown in rewrite mode", () => {
    const arc = { ...opened(), question: "the consortium is buying the valley" };
    const next = buildArcMessages(defaultSettings(), newGame(), [], arc, "next")
      .map((m) => m.content)
      .join("\n");
    const rewrite = buildArcMessages(defaultSettings(), newGame(), [], arc, "rewrite")
      .map((m) => m.content)
      .join("\n");

    expect(next).toContain("THE CHAPTER THAT JUST CLOSED");
    expect(next).not.toContain("THE CHAPTER BEING REPLACED");
    expect(rewrite).toContain("THE CHAPTER BEING REPLACED");
    expect(rewrite).not.toContain("THE CHAPTER THAT JUST CLOSED");
    // Both are shown the same arc — only what to do with it differs.
    expect(rewrite).toContain("the consortium is buying the valley");
  });

  it("defaults to the handoff wording, so an unmoded call is byte-identical", () => {
    const arc = opened();
    expect(buildArcMessages(defaultSettings(), newGame(), [], arc)).toEqual(
      buildArcMessages(defaultSettings(), newGame(), [], arc, "next"),
    );
  });

  it("pulls in the World Notes the player's guidance names", () => {
    const notes: Note[] = [
      { id: "n1", title: "The Sunken Choir", keywords: [], content: "drowned singers", permanent: false },
      { id: "n2", title: "The Ashen Legion", keywords: [], content: "mercenaries", permanent: false },
    ];
    const game = { ...newGame(), worldNotes: notes };

    const blank = buildArcMessages(defaultSettings(), game, [], undefined)
      .map((m) => m.content)
      .join("\n");
    expect(blank).not.toContain("drowned singers");

    const guided = buildArcMessages(
      { ...defaultSettings(), arcGuidance: "give me the sunken choir" },
      game,
      [],
      undefined,
    )
      .map((m) => m.content)
      .join("\n");
    expect(guided).toContain("drowned singers");
    // Only the one the guidance named — matching is still keyword matching.
    expect(guided).not.toContain("mercenaries");
  });
});

describe("arcScanText", () => {
  it("scans the guidance, the scenario and the arc in hand", () => {
    const game = {
      ...newGame(),
      scenario: { ...newGame().scenario, title: "Murkwood", premise: "a wet valley" },
    };
    const arc = { ...opened(), question: "who owns the mine" };
    const text = arcScanText(game, arc, "  keep it underground  ");
    expect(text).toContain("keep it underground");
    expect(text).toContain("Murkwood");
    expect(text).toContain("a wet valley");
    expect(text).toContain("who owns the mine");
    expect(text).toContain("the mine floods");
  });

  it("survives no arc and no guidance", () => {
    expect(() => arcScanText(newGame(), undefined)).not.toThrow();
  });
});

describe("rewriteArc", () => {
  const played = (): Arc => ({
    ...opened(1),
    epoch: 2,
    areas: ["murkwood"],
    openedTurn: 4,
    front: { label: "the mine floods", steps: ["a", "b"], ticks: 1, lastTickDay: 3, status: "open" },
  });

  const replacement: ArcTemplate = {
    question: "the warden is selling the pass",
    front: { label: "the pass closes", steps: ["c", "d", "e"] },
  };

  it("keeps the arc's seat and rewrites everything the model wrote", () => {
    const next = rewriteArc(played(), replacement, 9);
    expect(next.id).toBe("arc-1");
    expect(next.openedTurn).toBe(4);
    expect(next.areas).toEqual(["murkwood"]);
    expect(next.question).toBe("the warden is selling the pass");
    expect(next.front?.label).toBe("the pass closes");
    expect(next.front?.steps).toEqual(["c", "d", "e"]);
  });

  it("starts the clock again from zero, on today", () => {
    const next = rewriteArc(played(), replacement, 9);
    expect(next.front?.ticks).toBe(0);
    expect(next.front?.lastTickDay).toBe(9);
    expect(next.front?.status).toBe("open");
  });

  it("bumps the epoch, so every area prepped under the old question is stale", () => {
    expect(rewriteArc(played(), replacement, 9).epoch).toBe(3);
  });

  it("clears the staging it was applied from", () => {
    const staged = { ...played(), staged: replacement };
    expect(rewriteArc(staged, replacement, 9).staged).toBeUndefined();
  });

  it("pins the arc back to running, whatever state it was called in", () => {
    const paused = toInterlude(played(), 7);
    const next = rewriteArc(paused, replacement, 9);
    expect(next.status).toBe("running");
    expect(next.interludeFrom).toBeUndefined();
  });

  it("drops the front entirely for a template that has none", () => {
    const next = rewriteArc(played(), { question: "just a question" }, 9);
    expect(next.front).toBeUndefined();
    expect(next.question).toBe("just a question");
  });
});
