import { describe, it, expect } from "vitest";
import type { AreaCard, Arc, RoomSlot } from "../types";
import {
  GRID_LIMIT,
  addRoom,
  applyExits,
  areaIsStale,
  areaOfRoom,
  cellKey,
  formatAreaBlock,
  formatRoomBlock,
  normalizeCoord,
  normalizeMap,
  placeKey,
  preparedOutcome,
  resolveAreaKey,
  roomIsStale,
  seedRooms,
  spiralFrom,
  visitRoom,
} from "./gazetteer";

const room = (name: string, patch: Partial<RoomSlot> = {}): RoomSlot => ({
  name,
  coord: { x: 0, y: 0 },
  exits: [],
  visited: false,
  card: null,
  ...patch,
});

const area = (patch: Partial<AreaCard> = {}): AreaCard => ({
  key: "murkwood",
  name: "Murkwood",
  arcId: "arc-1",
  epoch: 0,
  version: 1,
  coord: { x: 0, y: 0 },
  neighbours: [],
  texture: "",
  threats: [],
  rooms: {},
  ...patch,
});

const arc = (patch: Partial<Arc> = {}): Arc =>
  ({
    id: "arc-1",
    question: "",
    epoch: 0,
    status: "running",
    areas: [],
    openedTurn: 0,
    ...patch,
  }) as Arc;

describe("placeKey", () => {
  it("folds the spelling family a narrator drifts through into one key", () => {
    expect(placeKey("Forest Entrance")).toBe("forest-entrance");
    expect(placeKey("the forest entrance")).toBe("forest-entrance");
    expect(placeKey("Forest Entrance.")).toBe("forest-entrance");
    expect(placeKey("  THE   Forest  Entrance ")).toBe("forest-entrance");
  });

  it("only strips a LEADING article, and never the whole name", () => {
    expect(placeKey("Theatre")).toBe("theatre");
    expect(placeKey("An Ash Grove")).toBe("ash-grove");
    // Stripping would leave nothing, so the bare slug stands.
    expect(placeKey("The")).toBe("the");
  });

  it("is blank for a name with nothing in it", () => {
    expect(placeKey("")).toBe("");
    expect(placeKey("   ")).toBe("");
  });
});

describe("spiralFrom", () => {
  it("returns the origin when it is free", () => {
    expect(spiralFrom({ x: 2, y: -1 }, new Set())).toEqual({ x: 2, y: -1 });
  });

  it("is deterministic — the same inputs place the same cell", () => {
    const taken = new Set(["0,0"]);
    expect(spiralFrom({ x: 0, y: 0 }, taken)).toEqual(spiralFrom({ x: 0, y: 0 }, taken));
  });

  it("never returns a taken cell, however many are taken", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const cell = spiralFrom({ x: 0, y: 0 }, taken);
      expect(taken.has(cellKey(cell))).toBe(false);
      taken.add(cellKey(cell));
    }
    expect(taken.size).toBe(25);
  });

  it("stays inside the bounded grid", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const cell = spiralFrom({ x: GRID_LIMIT, y: GRID_LIMIT }, taken);
      expect(Math.abs(cell.x)).toBeLessThanOrEqual(GRID_LIMIT);
      expect(Math.abs(cell.y)).toBeLessThanOrEqual(GRID_LIMIT);
      taken.add(cellKey(cell));
    }
  });
});

describe("normalizeCoord", () => {
  it("clamps to the grid and lands garbage on the origin", () => {
    expect(normalizeCoord({ x: 999, y: -999 })).toEqual({ x: GRID_LIMIT, y: -GRID_LIMIT });
    expect(normalizeCoord({ x: 1.7, y: 2.2 })).toEqual({ x: 2, y: 2 });
    expect(normalizeCoord(undefined)).toEqual({ x: 0, y: 0 });
    expect(normalizeCoord({ x: "north" })).toEqual({ x: 0, y: 0 });
  });
});

describe("addRoom", () => {
  it("returns the SAME card for a room already there", () => {
    const a = addRoom(area(), "The Stile");
    expect(addRoom(a, "stile")).toBe(a);
  });

  it("places a new room beside the one it was entered from, both ways", () => {
    let a = addRoom(area(), "Forest Entrance");
    a = addRoom(a, "The Stile", "forest-entrance");
    expect(a.rooms["stile"].exits).toEqual(["forest-entrance"]);
    expect(a.rooms["forest-entrance"].exits).toEqual(["stile"]);
    expect(a.rooms["stile"].coord).not.toEqual(a.rooms["forest-entrance"].coord);
  });

  it("ignores a name with no key in it", () => {
    const a = area();
    expect(addRoom(a, "   ")).toBe(a);
  });
});

describe("visitRoom", () => {
  it("adds an unlisted room rather than dropping the player nowhere", () => {
    const a = visitRoom(area(), "Drowned Gallery");
    expect(a.rooms["drowned-gallery"].visited).toBe(true);
  });

  it("is reference-stable once the room is already visited", () => {
    const a = visitRoom(area(), "Drowned Gallery");
    expect(visitRoom(a, "the drowned gallery")).toBe(a);
  });
});

describe("applyExits / seedRooms", () => {
  it("wires exits both ways and appends the rooms they name", () => {
    let a = visitRoom(area(), "Forest Entrance");
    a = applyExits(a, "forest-entrance", ["The Stile", "the deer path"]);
    expect(Object.keys(a.rooms).sort()).toEqual(["deer-path", "forest-entrance", "stile"]);
    expect(a.rooms["forest-entrance"].exits.sort()).toEqual(["deer-path", "stile"]);
    expect(a.rooms["deer-path"].exits).toEqual(["forest-entrance"]);
    // Rumours: named, never walked into.
    expect(a.rooms["stile"].visited).toBe(false);
  });

  it("seeds names only — no cards, nothing visited", () => {
    const a = seedRooms(area(), ["The Stile", "Wardens' Camp"]);
    expect(Object.values(a.rooms).every((r) => r.card === null && !r.visited)).toBe(true);
  });
});

describe("areaOfRoom / resolveAreaKey", () => {
  const areas = {
    murkwood: area({ rooms: { "forest-entrance": room("Forest Entrance") } }),
  };

  it("resolves the area off the room lists — no model channel needed", () => {
    expect(areaOfRoom(areas, "the Forest Entrance")).toBe("murkwood");
    expect(areaOfRoom(areas, "Rodstroke")).toBeNull();
  });

  it("prefers the room list over a narrator-named region", () => {
    expect(resolveAreaKey(areas, "Forest Entrance", "Somewhere Else", null)).toBe("murkwood");
  });

  it("falls to a narrator-named NEW region when the room resolves nothing", () => {
    expect(resolveAreaKey(areas, "Cellar", "Rodstroke", "murkwood")).toBe("rodstroke");
  });

  it("keeps the player where they were when nothing resolves at all", () => {
    expect(resolveAreaKey(areas, "Cellar", undefined, "murkwood")).toBe("murkwood");
    expect(resolveAreaKey({}, "Cellar", undefined, null)).toBeNull();
  });
});

describe("staleness", () => {
  it("is the PAIR — a matching epoch under a different arc is still stale", () => {
    const card = area({ arcId: "arc-1", epoch: 2 });
    expect(areaIsStale(card, arc({ id: "arc-1", epoch: 2 }))).toBe(false);
    expect(areaIsStale(card, arc({ id: "arc-2", epoch: 2 }))).toBe(true);
    expect(areaIsStale(card, arc({ id: "arc-1", epoch: 3 }))).toBe(true);
  });

  it("nothing is stale with no arc — single-scope foresight is legal", () => {
    expect(areaIsStale(area({ arcId: "arc-9", epoch: 4 }), undefined)).toBe(false);
  });

  it("marks a room card written under an older version of its region", () => {
    const card = { version: 1, openedTurn: 0, danger: "", threats: [], hooks: [], outcomes: { strong: "", mixed: "", cost: "" } };
    expect(roomIsStale(area({ version: 1 }), room("x", { card }))).toBe(false);
    expect(roomIsStale(area({ version: 2 }), room("x", { card }))).toBe(true);
    // A room with no card is not stale, it is unprepped.
    expect(roomIsStale(area({ version: 2 }), room("x"))).toBe(false);
  });
});

describe("normalizeMap", () => {
  it("pushes two rooms off one cell", () => {
    const out = normalizeMap({
      murkwood: area({
        rooms: {
          a: room("A", { coord: { x: 1, y: 1 } }),
          b: room("B", { coord: { x: 1, y: 1 } }),
        },
      }),
    });
    const rooms = out.murkwood.rooms;
    expect(cellKey(rooms.a.coord)).not.toBe(cellKey(rooms.b.coord));
  });

  it("drops an exit naming nobody and mirrors the ones that survive", () => {
    const out = normalizeMap({
      murkwood: area({
        rooms: {
          a: room("A", { exits: ["b", "ghost"] }),
          b: room("B"),
        },
      }),
    });
    expect(out.murkwood.rooms.a.exits).toEqual(["b"]);
    expect(out.murkwood.rooms.b.exits).toEqual(["a"]);
  });

  it("clamps a hand-edited coordinate onto the grid", () => {
    const out = normalizeMap({
      murkwood: area({ rooms: { a: room("A", { coord: { x: 4000, y: 0 } }) } }),
    });
    expect(out.murkwood.rooms.a.coord.x).toBe(GRID_LIMIT);
  });

  it("is reference-stable on a gazetteer that was already clean", () => {
    const areas = { murkwood: area({ rooms: { a: room("A") } }) };
    expect(normalizeMap(areas)).toBe(areas);
    expect(normalizeMap(undefined)).toEqual({});
  });
});

describe("the card readers", () => {
  it("says nothing for a card with nothing on it", () => {
    expect(formatAreaBlock(undefined)).toBe("");
    expect(formatAreaBlock(area())).toBe("");
    expect(formatRoomBlock(area(), undefined)).toBe("");
    expect(formatRoomBlock(area(), room("A"))).toBe("");
  });

  it("prints the region's texture and standing threats", () => {
    const block = formatAreaBlock(area({ texture: "old growth, wet", threats: ["patrols at dusk"] }));
    expect(block).toContain("AREA — Murkwood");
    expect(block).toContain("old growth, wet");
    expect(block).toContain("standing: patrols at dusk");
  });

  it("renders exits by DISPLAY name, not by key", () => {
    const a = area({
      rooms: {
        "forest-entrance": room("Forest Entrance", {
          exits: ["stile"],
          card: {
            version: 1,
            openedTurn: 1,
            danger: "the cart track ends at a stile",
            threats: ["the stile is watched"],
            hooks: ["a warden's mark"],
            outcomes: { strong: "S", mixed: "M", cost: "C" },
          },
        }),
        stile: room("The Stile"),
      },
    });
    const block = formatRoomBlock(a, a.rooms["forest-entrance"]);
    expect(block).toContain("ways out: The Stile");
    // The bands never appear in the room block — only the one that rolled does,
    // and it rides the OUTCOME block instead.
    expect(block).not.toContain("strong");
    expect(block).not.toContain("cost");
  });
});

describe("preparedOutcome", () => {
  const card = {
    version: 1,
    openedTurn: 1,
    danger: "",
    threats: [],
    hooks: [],
    outcomes: { strong: "the stair holds", mixed: "", cost: "the stair collapses" },
  };

  it("returns only the band that rolled", () => {
    expect(preparedOutcome(room("A", { card }), "cost")).toBe("the stair collapses");
    expect(preparedOutcome(room("A", { card }), "strong")).toBe("the stair holds");
  });

  it("is blank with no card, no room and no roll", () => {
    expect(preparedOutcome(room("A", { card }), null)).toBe("");
    expect(preparedOutcome(room("A"), "cost")).toBe("");
    expect(preparedOutcome(undefined, "cost")).toBe("");
    // A band the prep left blank makes no claim.
    expect(preparedOutcome(room("A", { card }), "mixed")).toBe("");
  });
});
