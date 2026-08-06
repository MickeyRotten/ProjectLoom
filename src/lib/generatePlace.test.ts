import { describe, it, expect } from "vitest";
import type { GameState, Message, Settings } from "../types";
import { defaultSettings, newGame } from "./defaults";
import {
  arrivalBeats,
  buildPlaceMessages,
  formatKindMenu,
  formatKnownWorldBlock,
  parseGeneratedPlace,
  parseTagObject,
  placeScanText,
} from "./generatePlace";
import { placeStub } from "./places";

const settings: Settings = defaultSettings();

function gameWith(patch: Partial<GameState> = {}): GameState {
  return { ...newGame(), ...patch };
}

function beat(role: Message["role"], content: string, turn = 1): Message {
  return { id: `${role}-${turn}`, role, content, turn };
}

describe("formatKindMenu", () => {
  it("is generated from the schema, so the model and the editor cannot drift", () => {
    const menu = formatKindMenu();
    expect(menu).toContain('"steading"');
    expect(menu).toContain('"dungeon"');
    expect(menu).toContain('"wild"');
    // The slots that only exist on one kind each.
    expect(menu).toContain('"prosperity"');
    expect(menu).toContain('"ruination"');
    expect(menu).toContain('"denizens"');
  });

  it("offers the shipped values as suggestions", () => {
    expect(formatKindMenu()).toContain("Dirt · Poor · Moderate · Wealthy · Rich");
  });
});

describe("parseTagObject", () => {
  it("flattens the reply's object onto the stored rows", () => {
    expect(
      parseTagObject({ prosperity: "Poor", trade: ["Torsea", "Ennet Bend"] }, "steading"),
    ).toEqual([
      { slot: "prosperity", value: "Poor" },
      { slot: "trade", value: "Torsea" },
      { slot: "trade", value: "Ennet Bend" },
    ]);
  });

  it("drops a key the chosen kind has no slot for", () => {
    expect(parseTagObject({ prosperity: "Rich", travel: "rough" }, "wild")).toEqual([
      { slot: "travel", value: "rough" },
    ]);
  });

  it("takes the first entry when a single-value slot is handed a list", () => {
    expect(parseTagObject({ travel: ["easy", "rough"] }, "wild")).toEqual([
      { slot: "travel", value: "easy" },
    ]);
  });

  it("takes a bare string for a list slot", () => {
    expect(parseTagObject({ denizens: "wolves" }, "wild")).toEqual([
      { slot: "denizens", value: "wolves" },
    ]);
  });

  it("reads nothing out of a non-object", () => {
    expect(parseTagObject(["Poor"], "steading")).toEqual([]);
    expect(parseTagObject(null, "steading")).toEqual([]);
  });
});

describe("parseGeneratedPlace", () => {
  const reply = JSON.stringify({
    kind: "steading",
    type: "village",
    description: "A muddy village of forty souls.",
    tags: { prosperity: "Poor", trade: ["Ennet Bend"] },
    rumours: ["The miller's boy is missing."],
    rooms: [
      { name: "The Wend Mill", description: "Wheel long since still.", unique: true },
      { name: "Cottage", description: "One of many." },
    ],
    keywords: ["the village"],
  });

  it("reads the sheet, taking id and name from the caller", () => {
    const place = parseGeneratedPlace(reply, "p9", "Rodstroke");
    expect(place).toMatchObject({ id: "p9", name: "Rodstroke", kind: "steading", type: "village" });
    expect(place?.tags).toEqual([
      { slot: "prosperity", value: "Poor" },
      { slot: "trade", value: "Ennet Bend" },
    ]);
    expect(place?.rooms[0]).toEqual({
      name: "The Wend Mill",
      description: "Wheel long since still.",
      unique: true,
    });
  });

  it("never carries a pending flag — it has just been written", () => {
    expect(parseGeneratedPlace(reply, "p9", "Rodstroke")?.pending).toBeUndefined();
  });

  it("ignores a name the model tried to supply", () => {
    const renamed = JSON.stringify({ name: "Somewhere Else", description: "A place." });
    expect(parseGeneratedPlace(renamed, "p9", "Rodstroke")?.name).toBe("Rodstroke");
  });

  it("survives fences and preamble, like every other parser here", () => {
    const messy = 'Sure!\n```json\n{ "description": "A place.", }\n```';
    expect(parseGeneratedPlace(messy, "p9", "Rodstroke")?.description).toBe("A place.");
  });

  it("fails on a reply with nothing usable, so the stub is left alone", () => {
    expect(parseGeneratedPlace("{}", "p9", "Rodstroke")).toBeNull();
    expect(parseGeneratedPlace('{ "kind": "wild" }', "p9", "Rodstroke")).toBeNull();
    expect(parseGeneratedPlace("not json at all", "p9", "Rodstroke")).toBeNull();
  });

  it("fails on a blank name — there would be nothing to resolve", () => {
    expect(parseGeneratedPlace(reply, "p9", "  ")).toBeNull();
  });

  it("takes rooms given as bare names", () => {
    const bare = JSON.stringify({ description: "A place.", rooms: ["Cell Block", "Oubliette"] });
    expect(parseGeneratedPlace(bare, "p9", "Korvenhald")?.rooms).toEqual([
      { name: "Cell Block", description: "" },
      { name: "Oubliette", description: "" },
    ]);
  });

  it("falls an unknown kind to wild, and drops the tags that kind cannot hold", () => {
    const odd = JSON.stringify({
      kind: "castle",
      description: "A place.",
      tags: { prosperity: "Rich", travel: "rough" },
    });
    const place = parseGeneratedPlace(odd, "p9", "Korvenhald");
    expect(place?.kind).toBe("wild");
    expect(place?.tags).toEqual([{ slot: "travel", value: "rough" }]);
  });
});

describe("arrival context", () => {
  const game = gameWith({
    messages: [
      beat("player", "We follow the road east."),
      beat("narrator", "The trees thin, and a palisade rises out of the fog."),
    ],
  });

  it("reads the beats — unlike the ✦ flows, which are forbidden them", () => {
    const beats = arrivalBeats(game);
    expect(beats).toContain("PLAYER: We follow the road east.");
    expect(beats).toContain("NARRATOR: The trees thin");
  });

  it("scans the area's name and the beats for World Notes", () => {
    const scan = placeScanText(game, "Rodstroke");
    expect(scan).toContain("Rodstroke");
    expect(scan).toContain("palisade");
  });
});

describe("formatKnownWorldBlock", () => {
  it("is empty when this is the only place", () => {
    expect(formatKnownWorldBlock([placeStub("p1", "Rodstroke")], "Rodstroke")).toBe("");
  });

  it("names the others without re-describing them", () => {
    const block = formatKnownWorldBlock(
      [placeStub("p1", "Rodstroke"), placeStub("p2", "Torsea")],
      "Rodstroke",
    );
    expect(block).toContain("Torsea");
    expect(block).not.toContain("- Rodstroke");
    expect(block).toContain("Do not re-describe these");
  });
});

describe("buildPlaceMessages", () => {
  const game = gameWith({
    messages: [beat("narrator", "A palisade rises out of the fog.")],
    places: [placeStub("p9", "Rodstroke")],
  });

  it("asks for one JSON object and ends on the area being written", () => {
    const messages = buildPlaceMessages({ game, settings, name: "Rodstroke" });
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("single JSON object");
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("Rodstroke");
  });

  it("carries the narrator's voice, so an area reads as part of the same world", () => {
    const messages = buildPlaceMessages({ game, settings, name: "Rodstroke" });
    expect(messages.some((m) => m.content.includes("STANDING INSTRUCTIONS"))).toBe(true);
  });

  it("carries the beats that led here", () => {
    const messages = buildPlaceMessages({ game, settings, name: "Rodstroke" });
    expect(messages.some((m) => m.content.includes("palisade"))).toBe(true);
  });

  it("forbids writing the scene rather than the place", () => {
    const messages = buildPlaceMessages({ game, settings, name: "Rodstroke" });
    expect(messages[0].content).toContain("Write the place, not a scene");
  });

  it("skips the beats block on a game that has none", () => {
    const fresh = gameWith({ messages: [] });
    const messages = buildPlaceMessages({ game: fresh, settings, name: "Rodstroke" });
    expect(messages.some((m) => m.content.includes("HOW THE PLAYER GOT HERE"))).toBe(false);
  });
});
