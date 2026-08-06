import { describe, it, expect } from "vitest";
import type { Place } from "../types";
import {
  MAX_ROOMS,
  MAX_RUMOURS,
  PLACE_KINDS,
  addNeighbourStubs,
  ensurePlace,
  fillPlace,
  findPlace,
  formatCurrentPlaceBlock,
  formatKnownPlacesBlock,
  kindDef,
  matchPlaces,
  neighbourNames,
  normalizePlace,
  normalizePlaces,
  placeHeading,
  placeKind,
  placeStub,
  setTagValues,
  slotsOf,
  tagValues,
} from "./places";

function place(patch: Partial<Place> & { id: string; name: string }): Place {
  return {
    kind: "steading",
    type: "town",
    description: "",
    tags: [],
    rumours: [],
    rooms: [],
    keywords: [],
    ...patch,
  };
}

const rodstroke = place({
  id: "p1",
  name: "Rodstroke",
  type: "village",
  description: "A muddy village of forty souls.",
  tags: [
    { slot: "prosperity", value: "Poor" },
    { slot: "trade", value: "Ennet Bend" },
    { slot: "tags", value: "Lawless" },
  ],
  rumours: ["The miller's boy has not been seen since the frost."],
  rooms: [
    { name: "Cottage", description: "One of many." },
    { name: "The Wend Mill", description: "Wheel long since still.", unique: true },
  ],
  keywords: ["the village"],
});

const murkwood = place({
  id: "p2",
  name: "Murkwood",
  kind: "wild",
  type: "forest",
  description: "Old oaks, close-grown.",
  tags: [{ slot: "travel", value: "rough" }],
});

describe("placeKind", () => {
  it("keeps a known kind", () => {
    expect(placeKind("dungeon")).toBe("dungeon");
    expect(placeKind("STEADING")).toBe("steading");
  });

  it("falls anything unrecognised to wild", () => {
    // The safest of the three to be wrong about: no people, no walls, no
    // economy — nothing a wrong guess puts in the prompt.
    expect(placeKind("castle")).toBe("wild");
    expect(placeKind(undefined)).toBe("wild");
    expect(placeKind(7)).toBe("wild");
  });
});

describe("the kind schema", () => {
  it("gives every kind a free-text slot, so no fact is unrecordable", () => {
    for (const kind of PLACE_KINDS) {
      expect(kind.slots.some((s) => s.key === "tags")).toBe(true);
    }
  });

  it("puts prosperity on steadings only", () => {
    expect(slotsOf("steading").some((s) => s.key === "prosperity")).toBe(true);
    expect(slotsOf("dungeon").some((s) => s.key === "prosperity")).toBe(false);
    expect(slotsOf("wild").some((s) => s.key === "prosperity")).toBe(false);
  });

  it("marks exactly the slot that names other places as linking", () => {
    const linking = PLACE_KINDS.flatMap((k) => k.slots.filter((s) => s.links).map((s) => s.key));
    expect(linking).toEqual(["trade"]);
  });

  it("names the parts of each kind in its own words", () => {
    expect(kindDef("dungeon").roomLabel).toBe("Areas");
    expect(kindDef("steading").roomLabel).toBe("Locations");
  });
});

describe("normalizePlace", () => {
  it("drops a place with no name — it resolves to nothing and injects nothing", () => {
    expect(normalizePlace({ id: "x", name: "   " })).toBeNull();
    expect(normalizePlace(null)).toBeNull();
    expect(normalizePlace("Rodstroke")).toBeNull();
  });

  it("falls back to the supplied id when the stored one is missing", () => {
    expect(normalizePlace({ name: "Rodstroke" }, "p9")?.id).toBe("p9");
  });

  it("drops a tag whose slot the kind does not have", () => {
    const p = normalizePlace({
      id: "p1",
      name: "Murkwood",
      kind: "wild",
      tags: [
        { slot: "prosperity", value: "Rich" },
        { slot: "travel", value: "rough" },
      ],
    });
    expect(p?.tags).toEqual([{ slot: "travel", value: "rough" }]);
  });

  it("keeps a value outside the suggested options — they are suggestions", () => {
    const p = normalizePlace({
      id: "p1",
      name: "Rodstroke",
      kind: "steading",
      tags: [{ slot: "prosperity", value: "Destitute" }],
    });
    expect(p?.tags).toEqual([{ slot: "prosperity", value: "Destitute" }]);
  });

  it("de-duplicates a tag restated in the same slot", () => {
    const p = normalizePlace({
      id: "p1",
      name: "Rodstroke",
      tags: [
        { slot: "tags", value: "Lawless" },
        { slot: "tags", value: "lawless" },
      ],
    });
    expect(p?.tags).toHaveLength(1);
  });

  it("bounds rooms and rumours", () => {
    const p = normalizePlace({
      id: "p1",
      name: "Deep",
      rooms: Array.from({ length: 40 }, (_, i) => ({ name: `Room ${i}`, description: "" })),
      rumours: Array.from({ length: 40 }, (_, i) => `Rumour ${i}`),
    });
    expect(p?.rooms).toHaveLength(MAX_ROOMS);
    expect(p?.rumours).toHaveLength(MAX_RUMOURS);
  });

  it("drops a nameless room but keeps the rest", () => {
    const p = normalizePlace({
      id: "p1",
      name: "Deep",
      rooms: [{ name: "", description: "nowhere" }, { name: "Cell Block" }],
    });
    expect(p?.rooms).toEqual([{ name: "Cell Block", description: "" }]);
  });

  it("keeps blank blank — an emptied description is not a description to refill", () => {
    expect(normalizePlace({ id: "p1", name: "Rodstroke", description: "" })?.description).toBe("");
  });
});

describe("normalizePlaces", () => {
  it("returns the same reference when nothing needed folding", () => {
    const stored = [rodstroke, murkwood];
    expect(normalizePlaces(stored)).toBe(stored);
  });

  it("drops rows that are not places", () => {
    expect(normalizePlaces([rodstroke, { id: "x" }, null])).toEqual([rodstroke]);
  });

  it("does not read a different key order as a change", () => {
    // `JSON.stringify` would: a stored document whose keys happen to sit in
    // another order is the same place, and calling it changed would snapshot
    // every place on every turn of every older save.
    const { id, name, ...rest } = murkwood;
    const stored = [{ name, id, ...rest }];
    expect(normalizePlaces(stored)).toBe(stored);
  });

  it("reads a missing list as none", () => {
    expect(normalizePlaces(undefined)).toEqual([]);
  });
});

describe("findPlace", () => {
  it("matches by name, case and punctuation insensitively", () => {
    expect(findPlace([rodstroke, murkwood], "rodstroke")?.id).toBe("p1");
  });

  it("matches an alias, so a narrator's second name for somewhere is not a second place", () => {
    const aliased = { ...murkwood, aliases: ["the Murkwood", "Old Wood"] };
    expect(findPlace([aliased], "Old Wood")?.id).toBe("p2");
  });

  it("does not match a blank", () => {
    expect(findPlace([rodstroke], "")).toBeUndefined();
    expect(findPlace([rodstroke], "   ")).toBeUndefined();
  });
});

describe("ensurePlace", () => {
  it("appends a stub for somewhere new", () => {
    const grown = ensurePlace([rodstroke], "Korvenhald", "p9");
    expect(grown).toHaveLength(2);
    expect(grown[1]).toMatchObject({ id: "p9", name: "Korvenhald", pending: true });
  });

  it("returns the same array for a place already known — re-entry costs nothing", () => {
    const places = [rodstroke];
    expect(ensurePlace(places, "Rodstroke", "p9")).toBe(places);
  });

  it("returns the same array for a blank name", () => {
    const places = [rodstroke];
    expect(ensurePlace(places, "", "p9")).toBe(places);
    expect(ensurePlace(places, "Somewhere", "")).toBe(places);
  });
});

describe("fillPlace", () => {
  const authored = place({
    id: "ignored",
    name: "Renamed By The Model",
    description: "Written up.",
  });

  it("writes the sheet over the stub, keeping the stub's id and name", () => {
    const stub = placeStub("p9", "Korvenhald");
    const filled = fillPlace([rodstroke, stub], "p9", authored);
    expect(filled[1]).toMatchObject({ id: "p9", name: "Korvenhald", description: "Written up." });
    expect(filled[1].pending).toBeUndefined();
  });

  it("no-ops on an id that is gone — an undone turn must not be resurrected", () => {
    const places = [rodstroke];
    expect(fillPlace(places, "p9", authored)).toBe(places);
  });

  it("keeps aliases the player had already given the stub", () => {
    const stub = { ...placeStub("p9", "Korvenhald"), aliases: ["the Hold"] };
    expect(fillPlace([stub], "p9", authored)[0].aliases).toEqual(["the Hold"]);
  });
});

describe("neighbours", () => {
  it("reads the linking slot only", () => {
    expect(neighbourNames(rodstroke)).toEqual(["Ennet Bend"]);
  });

  it("reads nothing off a kind with no linking slot", () => {
    expect(neighbourNames(murkwood)).toEqual([]);
  });

  it("stubs every neighbour not already known", () => {
    let n = 0;
    const grown = addNeighbourStubs([rodstroke], rodstroke, () => `n${++n}`);
    expect(grown.map((p) => p.name)).toEqual(["Rodstroke", "Ennet Bend"]);
  });

  it("does not stub the place itself", () => {
    const selfish = { ...rodstroke, tags: [{ slot: "trade", value: "Rodstroke" }] };
    const places = [selfish];
    expect(addNeighbourStubs(places, selfish, () => "n1")).toBe(places);
  });
});

describe("tag editing", () => {
  it("reads one slot's values", () => {
    expect(tagValues(rodstroke, "trade")).toEqual(["Ennet Bend"]);
  });

  it("replaces one slot without disturbing the others", () => {
    const tags = setTagValues(rodstroke, "trade", ["Korvenhald", "Torsea"]);
    expect(tags.filter((t) => t.slot === "trade").map((t) => t.value)).toEqual([
      "Korvenhald",
      "Torsea",
    ]);
    expect(tags.filter((t) => t.slot === "prosperity")).toEqual([
      { slot: "prosperity", value: "Poor" },
    ]);
  });

  it("drops blanks, so clearing a field clears the slot", () => {
    expect(setTagValues(rodstroke, "prosperity", ["  "]).some((t) => t.slot === "prosperity")).toBe(
      false,
    );
  });

  it("rebuilds in schema order however the values were typed", () => {
    const scrambled = place({
      id: "p1",
      name: "Rodstroke",
      tags: [
        { slot: "tags", value: "Lawless" },
        { slot: "prosperity", value: "Poor" },
      ],
    });
    expect(setTagValues(scrambled, "trade", ["Torsea"]).map((t) => t.slot)).toEqual([
      "prosperity",
      "trade",
      "tags",
    ]);
  });
});

describe("matchPlaces", () => {
  it("matches a name on word boundaries", () => {
    expect(matchPlaces([rodstroke, murkwood], "we ride for Murkwood").map((p) => p.id)).toEqual([
      "p2",
    ]);
  });

  it("matches an extra keyword", () => {
    expect(matchPlaces([rodstroke], "back to the village").map((p) => p.id)).toEqual(["p1"]);
  });

  it("skips the place the scene is already in — that one rides in full", () => {
    expect(matchPlaces([rodstroke, murkwood], "Rodstroke and Murkwood", "p1")).toEqual([murkwood]);
  });

  it("matches nothing on blank scan text", () => {
    expect(matchPlaces([rodstroke], "   ")).toEqual([]);
  });

  it("respects the limit", () => {
    const many = [rodstroke, murkwood, place({ id: "p3", name: "Torsea" })];
    expect(matchPlaces(many, "Rodstroke Murkwood Torsea", undefined, 2)).toHaveLength(2);
  });
});

describe("placeHeading", () => {
  it("reads builder and type together — that pair IS what a dungeon is", () => {
    const dungeon = place({
      id: "p3",
      name: "Korvenhald",
      kind: "dungeon",
      type: "prison",
      tags: [{ slot: "builder", value: "dwarves" }],
    });
    expect(placeHeading(dungeon)).toBe("Korvenhald — dwarves prison");
  });

  it("is the bare name when nothing is known yet", () => {
    expect(placeHeading(placeStub("p9", "Korvenhald"))).toBe("Korvenhald");
  });
});

describe("formatCurrentPlaceBlock", () => {
  it("is empty when the scene is in no known area", () => {
    expect(formatCurrentPlaceBlock(undefined)).toBe("");
  });

  it("prints the sheet, splitting recurring parts from one-offs", () => {
    const block = formatCurrentPlaceBlock(rodstroke);
    expect(block).toContain("CURRENT AREA — Rodstroke — village");
    expect(block).toContain("Prosperity: Poor");
    expect(block).toContain("Trade: Ennet Bend");
    expect(block).toContain("as often as the place needs them");
    expect(block).toContain("- Cottage: One of many.");
    expect(block).toContain("ONE OF EACH");
    expect(block).toContain("- The Wend Mill");
  });

  it("marks rumours as believed rather than true", () => {
    expect(formatCurrentPlaceBlock(rodstroke)).toContain("not necessarily true");
  });

  it("never restates the room — CURRENT SCENE names it one block up", () => {
    expect(formatCurrentPlaceBlock(rodstroke)).not.toContain("The scene is in");
  });

  it("prints a stub's name rather than nothing, since the name is already a fact", () => {
    const block = formatCurrentPlaceBlock(placeStub("p9", "Korvenhald"));
    expect(block).toContain("CURRENT AREA — Korvenhald");
  });

  it("does not print the builder twice — it is already in the heading", () => {
    const dungeon = place({
      id: "p3",
      name: "Korvenhald",
      kind: "dungeon",
      type: "prison",
      tags: [{ slot: "builder", value: "dwarves" }],
    });
    expect(formatCurrentPlaceBlock(dungeon)).not.toContain("Builder:");
  });
});

describe("formatKnownPlacesBlock", () => {
  it("is empty with nothing matched", () => {
    expect(formatKnownPlacesBlock([])).toBe("");
  });

  it("is trimmed to name, kind and description — no rooms, no rumours", () => {
    const block = formatKnownPlacesBlock([rodstroke]);
    expect(block).toContain("Rodstroke — village");
    expect(block).toContain("A muddy village of forty souls.");
    expect(block).not.toContain("The Wend Mill");
    expect(block).not.toContain("miller's boy");
  });

  it("says so when a place is only a name", () => {
    expect(formatKnownPlacesBlock([placeStub("p9", "Korvenhald")])).toContain("known by name only");
  });

  it("states the negative — these are elsewhere", () => {
    expect(formatKnownPlacesBlock([rodstroke])).toContain("The player is NOT in these places");
  });
});
