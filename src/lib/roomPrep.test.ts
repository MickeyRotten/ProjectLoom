import { describe, it, expect } from "vitest";
import type { AreaCard, GameState, RoomCard, RoomSlot } from "../types";
import { defaultSettings, newGame } from "./defaults";
import { normalizeAreaCard } from "./areaPrep";
import {
  ROOM_MAX_HOOKS,
  ROOM_MAX_THREATS,
  buildRoomMessages,
  normalizeRoomCard,
  parseRoomCard,
  roomChanged,
  stampRoomCard,
} from "./roomPrep";

const card = (patch: Partial<RoomCard> = {}): RoomCard => ({
  version: 1,
  openedTurn: 4,
  danger: "the cart track ends at a stile",
  threats: [],
  hooks: [],
  outcomes: { strong: "", mixed: "", cost: "" },
  ...patch,
});

const room = (patch: Partial<RoomSlot> = {}): RoomSlot => ({
  name: "Forest Entrance",
  coord: { x: 0, y: 0 },
  exits: [],
  visited: true,
  card: null,
  ...patch,
});

const area = (patch: Partial<AreaCard> = {}): AreaCard =>
  normalizeAreaCard({ name: "Murkwood", version: 1, texture: "wet", ...patch }, "murkwood");

const game = (patch: Partial<GameState> = {}): GameState => ({ ...newGame(), ...patch });

describe("roomChanged", () => {
  it("is true for a room with no card, false once it has one", () => {
    expect(roomChanged(area(), room(), 5, 20)).toBe(true);
    expect(roomChanged(area(), room({ card: card() }), 5, 20)).toBe(false);
  });

  it("is true once the region has been prepped again under it", () => {
    expect(roomChanged(area({ version: 2 }), room({ card: card({ version: 1 }) }), 5, 20)).toBe(true);
  });

  it("re-preps after a long stay in one place — the turn ceiling", () => {
    expect(roomChanged(area(), room({ card: card({ openedTurn: 1 }) }), 21, 20)).toBe(true);
    expect(roomChanged(area(), room({ card: card({ openedTurn: 1 }) }), 19, 20)).toBe(false);
    // 0 switches the ceiling off entirely.
    expect(roomChanged(area(), room({ card: card({ openedTurn: 1 }) }), 9999, 0)).toBe(false);
  });

  it("preps nothing at all with no region prepped", () => {
    expect(roomChanged(undefined, room(), 5, 20)).toBe(false);
  });
});

describe("parseRoomCard", () => {
  it("reads the three bands under the keys stakes.ts already uses", () => {
    const parsed = parseRoomCard(
      JSON.stringify({
        danger: "sightlines die ten feet in",
        threats: ["the stile is watched"],
        hooks: ["a warden's mark"],
        exits: ["The Stile", "the track back"],
        outcomes: { strong: "S", mixed: "M", cost: "C" },
      }),
    );
    expect(parsed?.outcomes).toEqual({ strong: "S", mixed: "M", cost: "C" });
    expect(parsed?.exits).toEqual(["The Stile", "the track back"]);
  });

  it("keeps a card that came back without its outcomes — the exits still earn it", () => {
    const parsed = parseRoomCard('{ "danger": "a wet stair", "exits": ["Cellar"] }');
    expect(parsed?.danger).toBe("a wet stair");
    expect(parsed?.outcomes).toEqual({ strong: "", mixed: "", cost: "" });
  });

  it("caps threats and hooks", () => {
    const parsed = parseRoomCard(
      JSON.stringify({
        danger: "x",
        threats: ["a", "b", "c", "d", "e"],
        hooks: ["a", "b", "c", "d"],
      }),
    );
    expect(parsed?.threats).toHaveLength(ROOM_MAX_THREATS);
    expect(parsed?.hooks).toHaveLength(ROOM_MAX_HOOKS);
  });

  it("returns null when nothing usable came back", () => {
    expect(parseRoomCard("sorry, I can't")).toBeNull();
    expect(parseRoomCard('{ "outcomes": {} }')).toBeNull();
  });
});

describe("stampRoomCard / normalizeRoomCard", () => {
  it("stamps the version it was prepped under", () => {
    const stamped = stampRoomCard(
      { danger: "d", threats: [], hooks: [], exits: [], outcomes: { strong: "", mixed: "", cost: "" } },
      area({ version: 3 }),
      12,
    );
    expect(stamped).toMatchObject({ version: 3, openedTurn: 12 });
  });

  it("sanitizes a stored card, and reads a missing one as none", () => {
    expect(normalizeRoomCard(null)).toBeNull();
    expect(normalizeRoomCard(undefined)).toBeNull();
    const clean = normalizeRoomCard({
      version: -2,
      threats: ["a", "b", "c", "d"],
      outcomes: { strong: 7, cost: " C " } as unknown as RoomCard["outcomes"],
    });
    expect(clean).toMatchObject({ version: 1 });
    expect(clean?.threats).toHaveLength(ROOM_MAX_THREATS);
    expect(clean?.outcomes).toEqual({ strong: "", mixed: "", cost: "C" });
  });
});

describe("buildRoomMessages", () => {
  const populated = area({
    rooms: {
      "forest-entrance": room(),
      stile: room({ name: "The Stile", visited: false }),
    },
  });

  it("shows the region, forbids restating it, and names the other places in it", () => {
    const text = buildRoomMessages(defaultSettings(), game(), "Forest Entrance", populated)
      .map((m) => m.content)
      .join("\n");
    expect(text).toContain("SCENE PREP");
    expect(text).toContain("THE REGION — Murkwood");
    expect(text).toContain("Do NOT restate");
    expect(text).toContain("The Stile");
    // Never itself, which would read as somewhere else to go.
    expect(text).not.toContain("Other places in the region: Forest Entrance");
  });

  it("reads the last beats and the party's flaws — a cost lands on somebody", () => {
    const g = game({
      messages: [
        { id: "m1", role: "player", content: "OLD AND FORGOTTEN", turn: 1 },
        { id: "m2", role: "narrator", content: "beat one", turn: 1 },
        { id: "m3", role: "player", content: "middle", turn: 2 },
        { id: "m4", role: "narrator", content: "beat two", turn: 2 },
        { id: "m5", role: "player", content: "recent action", turn: 3 },
        { id: "m6", role: "narrator", content: "beat three", turn: 3 },
      ],
    });
    const party = [
      { ...g.characters[0], name: "Navi", flaws: "cannot keep quiet", lastSpokeTurn: 0, standing: "active" as const, condition: "" },
    ];
    const text = buildRoomMessages(defaultSettings(), g, "Forest Entrance", populated, party)
      .map((m) => m.content)
      .join("\n");

    expect(text).toContain("recent action");
    expect(text).toContain("cannot keep quiet");
    expect(text).not.toContain("OLD AND FORGOTTEN");
  });

  it("asks for a strong result that CHANGES the scene", () => {
    const text = buildRoomMessages(defaultSettings(), game(), "Forest Entrance", populated)
      .map((m) => m.content)
      .join("\n");
    expect(text).toContain("CHANGE THE SCENE");
  });
});
