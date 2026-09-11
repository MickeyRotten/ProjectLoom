import { describe, it, expect } from "vitest";
import type { GameState, Message, Settings } from "../types";
import { defaultSettings, newGame } from "./defaults";
import {
  arrivalBeats,
  buildPlaceMessages,
  formatKnownWorldBlock,
  parseGeneratedPlace,
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

describe("parseGeneratedPlace", () => {
  const reply = JSON.stringify({
    description: "A muddy village of forty souls.",
    keywords: ["the village"],
  });

  it("reads the sheet, taking id and name from the caller", () => {
    const place = parseGeneratedPlace(reply, "p9", "Rodstroke");
    expect(place).toMatchObject({
      id: "p9",
      name: "Rodstroke",
      description: "A muddy village of forty souls.",
      keywords: ["the village"],
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
    expect(parseGeneratedPlace('{ "keywords": [] }', "p9", "Rodstroke")).toBeNull();
    expect(parseGeneratedPlace("not json at all", "p9", "Rodstroke")).toBeNull();
  });

  it("fails on a blank name — there would be nothing to resolve", () => {
    expect(parseGeneratedPlace(reply, "p9", "  ")).toBeNull();
  });

  it("succeeds on keywords alone, with no description", () => {
    const keywordsOnly = JSON.stringify({ keywords: ["the mill"] });
    expect(parseGeneratedPlace(keywordsOnly, "p9", "Rodstroke")?.keywords).toEqual(["the mill"]);
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

  it("states the surprise budget", () => {
    const messages = buildPlaceMessages({ game, settings, name: "Rodstroke" });
    expect(messages[0].content).toContain("SURPRISE BUDGET");
  });

  it("skips the beats block on a game that has none", () => {
    const fresh = gameWith({ messages: [] });
    const messages = buildPlaceMessages({ game: fresh, settings, name: "Rodstroke" });
    expect(messages.some((m) => m.content.includes("HOW THE PLAYER GOT HERE"))).toBe(false);
  });

  it("carries the world seed, so the area agrees with the world's tone and factions", () => {
    const withSeed = gameWith({
      scenario: { ...newGame().scenario, tone: ["Grim but not hopeless"] },
    });
    const messages = buildPlaceMessages({ game: withSeed, settings, name: "Rodstroke" });
    expect(messages.some((m) => m.content.includes("Grim but not hopeless"))).toBe(true);
  });
});
