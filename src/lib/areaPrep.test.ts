import { describe, it, expect } from "vitest";
import type { AreaCard, GameState } from "../types";
import { defaultSettings, newGame } from "./defaults";
import { openArc } from "./arc";
import {
  AREA_MAX_ROOMS,
  AREA_MAX_THREATS,
  PREP_MAX_LINE_CHARS,
  areaChanged,
  buildAreaMessages,
  normalizeAreaCard,
  parseAreaCard,
  prepLines,
  stampAreaCard,
} from "./areaPrep";

const template = {
  question: "the consortium is buying the valley",
  spine: "flood",
  fronts: [{ id: "flood", label: "the mine floods", steps: ["a", "b"] }],
};

const arc = openArc(template, "arc-1", 0, 1);

const area = (patch: Partial<AreaCard> = {}): AreaCard =>
  normalizeAreaCard({ name: "Murkwood", arcId: "arc-1", epoch: 0, version: 1, ...patch }, "murkwood");

const game = (patch: Partial<GameState> = {}): GameState => ({ ...newGame(), ...patch });

describe("areaChanged", () => {
  it("is true for a region nothing has prepped", () => {
    expect(areaChanged(game(), "murkwood", arc)).toBe(true);
  });

  it("is false while the card's stamp still matches the running arc", () => {
    const g = game({ areas: { murkwood: area() } });
    expect(areaChanged(g, "murkwood", arc)).toBe(false);
  });

  it("is true once the arc's epoch has moved under it", () => {
    const g = game({ areas: { murkwood: area() } });
    expect(areaChanged(g, "murkwood", { ...arc, epoch: 1 })).toBe(true);
  });
});

describe("parseAreaCard", () => {
  it("reads a card out of a chatty, fenced reply", () => {
    const parsed = parseAreaCard(
      'Here you go:\n```json\n{ "texture": "old growth, wet", "threats": ["anything loud brings a patrol"], "rooms": ["The Stile", "Drowned Gallery"], "front": "flood" }\n```',
      arc,
    );
    expect(parsed).toEqual({
      texture: "old growth, wet",
      threats: ["anything loud brings a patrol"],
      rooms: ["The Stile", "Drowned Gallery"],
      front: "flood",
    });
  });

  it("accepts a front named by its LABEL as well as its id", () => {
    expect(parseAreaCard('{ "texture": "x", "front": "the mine floods" }', arc)?.front).toBe("flood");
  });

  it("drops a front naming nothing in the arc", () => {
    // Rooms inherit this: an area serving a front that does not exist would
    // quietly stop every cost outcome from ticking anything.
    expect(parseAreaCard('{ "texture": "x", "front": "the sky falls" }', arc)?.front).toBeUndefined();
    expect(parseAreaCard('{ "texture": "x", "front": "flood" }', undefined)?.front).toBeUndefined();
  });

  it("caps the threats and the room list", () => {
    const parsed = parseAreaCard(
      JSON.stringify({
        texture: "x",
        threats: Array.from({ length: 9 }, (_, i) => `t${i}`),
        rooms: Array.from({ length: 20 }, (_, i) => `r${i}`),
      }),
      arc,
    );
    expect(parsed?.threats).toHaveLength(AREA_MAX_THREATS);
    expect(parsed?.rooms).toHaveLength(AREA_MAX_ROOMS);
  });

  it("returns null when there is nothing usable, so nothing is cached", () => {
    expect(parseAreaCard("no json", arc)).toBeNull();
    expect(parseAreaCard('{ "texture": "  " }', arc)).toBeNull();
  });

  it("caps a line's length", () => {
    const long = "x".repeat(400);
    expect(prepLines([long], 1)[0]).toHaveLength(PREP_MAX_LINE_CHARS);
  });
});

describe("stampAreaCard", () => {
  const parsed = { texture: "old growth", threats: ["patrols"], rooms: [], front: "flood" };

  it("writes the arc pair and opens at version 1", () => {
    const card = stampAreaCard(parsed, "murkwood", "Murkwood", arc, undefined);
    expect(card).toMatchObject({ key: "murkwood", arcId: "arc-1", epoch: 0, version: 1 });
  });

  it("bumps the version on a re-prep — which is what marks its rooms stale", () => {
    const previous = area({ version: 3 });
    expect(stampAreaCard(parsed, "murkwood", "Murkwood", arc, previous).version).toBe(4);
  });

  it("KEEPS the rooms, unvisited rumours included", () => {
    const previous = area({
      rooms: {
        stile: { name: "The Stile", coord: { x: 1, y: 0 }, exits: [], visited: false, card: null },
      },
    });
    const card = stampAreaCard(parsed, "murkwood", "Murkwood", arc, previous);
    // A named room nobody has visited is a rumour, and rumours are hooks.
    expect(card.rooms.stile).toBeDefined();
  });
});

describe("normalizeAreaCard", () => {
  it("pins everything the client owns", () => {
    const card = normalizeAreaCard(
      {
        name: "  Murkwood ",
        version: -4,
        epoch: NaN,
        coord: { x: 900, y: -900 },
        threats: ["a", "b", "c", "d"],
        neighbours: ["x", 7 as unknown as string],
      },
      "murkwood",
    );
    expect(card).toMatchObject({ name: "Murkwood", version: 1, epoch: 0 });
    expect(card.coord).toEqual({ x: 16, y: -16 });
    expect(card.threats).toHaveLength(AREA_MAX_THREATS);
    expect(card.neighbours).toEqual(["x"]);
  });

  it("falls a nameless card back to its key rather than rendering blank", () => {
    expect(normalizeAreaCard({}, "murkwood").name).toBe("murkwood");
  });
});

describe("buildAreaMessages", () => {
  it("shows the arc and forbids restating it — the 'stated once' rule, enforced at authoring", () => {
    const text = buildAreaMessages(defaultSettings(), game(), "Murkwood", arc, [
      { id: "p1", text: "the tremor in the walls", plantedTurn: 2 },
    ])
      .map((m) => m.content)
      .join("\n");

    expect(text).toContain("AREA PREP");
    expect(text).toContain("the consortium is buying the valley");
    expect(text).toContain("Do NOT restate");
    expect(text).toContain("the tremor in the walls");
    expect(text).toContain("Prepare the region: Murkwood");
  });

  it("carries the player's own prep instructions", () => {
    const settings = { ...defaultSettings(), areaPrepInstructions: "SPEAK ONLY IN RIDDLES" };
    const text = buildAreaMessages(settings, game(), "Murkwood", undefined).map((m) => m.content).join("\n");
    expect(text).toContain("SPEAK ONLY IN RIDDLES");
  });

  it("ends on the user turn, so the model has something to answer", () => {
    const messages = buildAreaMessages(defaultSettings(), game(), "Murkwood", undefined);
    expect(messages[messages.length - 1].role).toBe("user");
  });
});
