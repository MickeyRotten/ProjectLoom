import { describe, it, expect } from "vitest";
import type { Place } from "../types";
import {
  ensurePlace,
  fillPlace,
  findPlace,
  formatCurrentPlaceBlock,
  formatKnownPlacesBlock,
  matchPlaces,
  normalizePlace,
  normalizePlaces,
  placeStub,
} from "./places";

function place(patch: Partial<Place> & { id: string; name: string }): Place {
  return { description: "", keywords: [], ...patch };
}

const rodstroke = place({
  id: "p1",
  name: "Rodstroke",
  description: "A muddy village of forty souls.",
  keywords: ["the village"],
});

const murkwood = place({
  id: "p2",
  name: "Murkwood",
  description: "Old oaks, close-grown.",
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

  it("keeps blank blank — an emptied description is not a description to refill", () => {
    expect(normalizePlace({ id: "p1", name: "Rodstroke", description: "" })?.description).toBe("");
  });

  it("keeps a description and keywords", () => {
    const p = normalizePlace({
      id: "p1",
      name: "Rodstroke",
      description: "A muddy village.",
      keywords: ["the village", "Wend"],
    });
    expect(p?.description).toBe("A muddy village.");
    expect(p?.keywords).toEqual(["the village", "Wend"]);
  });

  it("drops a retired field from an old save silently, rather than crashing", () => {
    const legacy = {
      id: "p1",
      name: "Rodstroke",
      kind: "steading",
      type: "village",
      tags: [{ slot: "prosperity", value: "Poor" }],
      rumours: ["The miller's boy is missing."],
      rooms: [{ name: "The Wend Mill", description: "" }],
      coords: { x: 3, y: -2, z: 1 },
      locations: [{ name: "The Wend Mill", coords: { x: 2, y: 0, z: 0 } }],
    };
    const p = normalizePlace(legacy);
    expect(p).toEqual({ id: "p1", name: "Rodstroke", description: "", keywords: [] });
  });

  it("keeps aliases", () => {
    const p = normalizePlace({ id: "p1", name: "Murkwood", aliases: ["the Murkwood", "Old Wood"] });
    expect(p?.aliases).toEqual(["the Murkwood", "Old Wood"]);
  });

  it("keeps pending", () => {
    expect(normalizePlace({ id: "p1", name: "Korvenhald", pending: true })?.pending).toBe(true);
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

describe("formatCurrentPlaceBlock", () => {
  it("is empty when the scene is in no known area", () => {
    expect(formatCurrentPlaceBlock(undefined)).toBe("");
  });

  it("prints the name and description", () => {
    const block = formatCurrentPlaceBlock(rodstroke);
    expect(block).toContain("CURRENT AREA — Rodstroke");
    expect(block).toContain("A muddy village of forty souls.");
  });

  it("never restates the room — CURRENT SCENE names it one block up", () => {
    expect(formatCurrentPlaceBlock(rodstroke)).not.toContain("The scene is in");
  });

  it("prints a stub's name rather than nothing, since the name is already a fact", () => {
    const block = formatCurrentPlaceBlock(placeStub("p9", "Korvenhald"));
    expect(block).toContain("CURRENT AREA — Korvenhald");
  });
});

describe("formatKnownPlacesBlock", () => {
  it("is empty with nothing matched", () => {
    expect(formatKnownPlacesBlock([])).toBe("");
  });

  it("is trimmed to name and description", () => {
    const block = formatKnownPlacesBlock([rodstroke]);
    expect(block).toContain("Rodstroke");
    expect(block).toContain("A muddy village of forty souls.");
  });

  it("says so when a place is only a name", () => {
    expect(formatKnownPlacesBlock([placeStub("p9", "Korvenhald")])).toContain("known by name only");
  });

  it("states the negative — these are elsewhere", () => {
    expect(formatKnownPlacesBlock([rodstroke])).toContain("The player is NOT in these places");
  });
});
