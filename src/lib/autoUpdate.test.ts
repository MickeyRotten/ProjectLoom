import { describe, it, expect } from "vitest";
import {
  buildAutoUpdateMessages,
  normalizeFields,
  parseAutoUpdate,
  recentMentions,
  type AutoField,
} from "./autoUpdate";
import { newGame, newMember } from "./defaults";
import type { Character, GameState, Message } from "../types";

function msg(patch: Partial<Message> & { content: string; turn: number }): Message {
  return { id: `m${patch.turn}-${patch.role ?? "narrator"}`, role: "narrator", ...patch };
}

function member(patch: Partial<Character> = {}): Character {
  return { ...newMember("m1"), name: "Elara", species: "elf", ...patch };
}

function gameWith(messages: Message[], characters: Character[] = []): GameState {
  return { ...newGame(), messages, characters };
}

const beats: Message[] = [
  msg({ content: "Elara scouts the treeline.", turn: 1 }),
  msg({ content: "You wade into the river.", turn: 2 }),
  msg({ content: "ELARA laughs at the joke.", turn: 3, role: "player" }),
  msg({ content: "Elarandir the mapmaker waves.", turn: 4 }),
  msg({ content: 'Elara: "We camp here."', turn: 5 }),
];

describe("recentMentions", () => {
  it("keeps only beats naming the character, in story order", () => {
    expect(recentMentions(beats, "Elara").map((m) => m.turn)).toEqual([1, 3, 5]);
  });

  it("matches on word boundaries, not substrings", () => {
    expect(recentMentions(beats, "Elara").some((m) => m.turn === 4)).toBe(false);
  });

  it("takes the latest N when the limit bites", () => {
    expect(recentMentions(beats, "Elara", 2).map((m) => m.turn)).toEqual([3, 5]);
  });

  it("returns nothing for a blank name", () => {
    expect(recentMentions(beats, "  ")).toEqual([]);
  });
});

describe("normalizeFields", () => {
  it("orders and de-duplicates", () => {
    expect(normalizeFields(["drive", "appearance", "drive"])).toEqual(["appearance", "drive"]);
  });
});

describe("buildAutoUpdateMessages", () => {
  const c = member({
    description: "Tall, silver-haired, a scar across one brow. Wears a patched cloak.",
    personality: "Wry and watchful.",
    drive: "Find her missing brother.",
    equipment: [{ label: "Ranger's Coat", description: "Oiled leather, deep hood." }],
  });

  function joined(fields: AutoField[], game = gameWith(beats, [c])) {
    return buildAutoUpdateMessages({ game, character: c, fields }).map((m) => m.content).join("\n");
  }

  it("asks for exactly the selected keys and only their rules", () => {
    const text = joined(["appearance"]);
    expect(text).toContain('these keys, each a plain string: "appearance"');
    expect(text).toContain("PRESERVE the character's physical characteristics");
    expect(text).not.toContain('"personality" — update');
    expect(text).not.toContain('"drive" — update');
  });

  it("always sends the whole sheet, equipment labels and descriptions included", () => {
    const text = joined(["personality"]);
    expect(text).toContain("Ranger's Coat: Oiled leather, deep hood.");
    expect(text).toContain("Wry and watchful.");
    expect(text).toContain("Find her missing brother.");
  });

  it("sends story context only when a story-driven field is selected", () => {
    expect(joined(["appearance"])).not.toContain("STORY CONTEXT");
    const text = joined(["drive"]);
    expect(text).toContain("STORY CONTEXT");
    expect(text).toContain('Elara: "We camp here."');
    // Beats that never name her stay out of the scan.
    expect(text).not.toContain("You wade into the river.");
  });

  it("says so explicitly when no beat mentions the character", () => {
    const text = joined(["personality"], gameWith([msg({ content: "Rain falls.", turn: 1 })], [c]));
    expect(text).toContain("no recent beat mentions Elara");
  });

  it("ends with the user instruction naming the selected fields", () => {
    const messages = buildAutoUpdateMessages({
      game: gameWith(beats, [c]),
      character: c,
      fields: ["drive", "appearance"],
    });
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("Update Appearance, Drive for Elara");
  });
});

describe("parseAutoUpdate", () => {
  it("maps appearance onto description and keeps the other fields", () => {
    const raw = '{"appearance":"Silver hair, oiled ranger coat.","drive":"Reach the coast."}';
    expect(parseAutoUpdate(raw, ["appearance", "drive"])).toEqual({
      description: "Silver hair, oiled ranger coat.",
      drive: "Reach the coast.",
    });
  });

  it("survives code fences, preamble, and trailing commas", () => {
    const raw = 'Sure!\n```json\n{\n  "personality": "Guarded, dry humour.",\n}\n```';
    expect(parseAutoUpdate(raw, ["personality"])).toEqual({ personality: "Guarded, dry humour." });
  });

  it("ignores keys that were not requested", () => {
    const raw = '{"personality":"Chatty.","drive":"Gold.","strengths":"nope"}';
    expect(parseAutoUpdate(raw, ["personality"])).toEqual({ personality: "Chatty." });
  });

  it("drops blank and non-string values instead of wiping the sheet", () => {
    const raw = '{"appearance":"   ","personality":null,"drive":42}';
    expect(parseAutoUpdate(raw, ["appearance", "personality", "drive"])).toEqual({});
  });

  it("returns nothing when there is no JSON at all", () => {
    expect(parseAutoUpdate("I cannot help with that.", ["drive"])).toEqual({});
  });
});
