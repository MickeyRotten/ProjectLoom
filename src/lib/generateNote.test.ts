import { describe, it, expect } from "vitest";
import {
  MAX_NOTE_KEYWORDS,
  buildNoteMessages,
  formatKnownLoreBlock,
  normalizeNoteKeywords,
  parseGeneratedNote,
} from "./generateNote";
import { newGame } from "./defaults";
import type { GameState, Note } from "../types";

function gameWith(notes: Note[] = []): GameState {
  const game = newGame();
  return {
    ...game,
    scenario: {
      ...game.scenario,
      title: "Legend of Mesmeria",
      premise: "A premise about airships.",
    },
    worldNotes: notes,
  };
}

function note(patch: Partial<Note> & { id: string; title: string }): Note {
  return { content: "", keywords: [], permanent: false, ...patch };
}

function joined(
  opts: { game?: GameState; existing?: Note[]; draft?: Note; hint?: string } = {},
) {
  return buildNoteMessages({
    game: opts.game ?? gameWith(),
    existing: opts.existing ?? [],
    draft: opts.draft,
    hint: opts.hint,
  })
    .map((m) => m.content)
    .join("\n");
}

describe("buildNoteMessages — the contract", () => {
  it("asks for all three keys in one object", () => {
    const text = joined();
    expect(text).toContain('"title"');
    expect(text).toContain('"content"');
    expect(text).toContain('"keywords"');
    expect(text).toContain("no code fences");
  });

  it("sends the scenario as setting", () => {
    expect(joined()).toContain("A premise about airships.");
  });

  it("never sends the story — this is authoring, not a turn", () => {
    const game = gameWith();
    const text = joined({
      game: {
        ...game,
        messages: [
          { id: "m1", role: "narrator", content: "A drowned bell tolled below.", turn: 3 },
        ],
      },
    });
    expect(text).not.toContain("drowned bell");
  });
});

describe("buildNoteMessages — lore already written", () => {
  const lore: Note[] = [
    note({ id: "n1", title: "Ashen Legion", content: "Mercenaries in grey." }),
    note({ id: "n2", title: "Sunken Choir", content: "Drowned singers." }),
  ];

  it("lists the existing lore, and says not to restate it", () => {
    const text = joined({ existing: lore });
    expect(text).toContain("LORE ALREADY WRITTEN");
    expect(text).toContain("Ashen Legion: Mercenaries in grey.");
    expect(text).toContain("Sunken Choir: Drowned singers.");
    expect(text).toContain("Write a DIFFERENT note");
  });

  it("shows nothing when there is no other lore", () => {
    expect(formatKnownLoreBlock([])).toBe("");
    expect(formatKnownLoreBlock([note({ id: "x", title: "  " })])).toBe("");
  });
});

describe("buildNoteMessages — the draft", () => {
  it("keeps a working title the player typed", () => {
    const text = joined({ draft: note({ id: "n1", title: "The Old Well" }) });
    expect(text).toContain("STARTING POINT");
    expect(text).toContain("Working title: The Old Well");
  });

  it("adds no starting point for an untouched note", () => {
    expect(joined({ draft: note({ id: "n1", title: "  " }) })).not.toContain("STARTING POINT");
  });
});

describe("buildNoteMessages — guidance", () => {
  it("puts the guidance last, so it outranks the lore it may contradict", () => {
    const messages = buildNoteMessages({
      game: gameWith(),
      existing: [note({ id: "n1", title: "Ashen Legion", content: "Grey." })],
      hint: "a rival faction to the Ashen Legion",
    });
    const guidance = messages.findIndex((m) => m.content.startsWith("PLAYER GUIDANCE"));
    const lore = messages.findIndex((m) => m.content.startsWith("LORE ALREADY WRITTEN"));
    expect(guidance).toBeGreaterThan(lore);
    // Only the closing user turn comes after it.
    expect(messages[guidance + 1].role).toBe("user");
  });

  it("adds nothing at all when there is no guidance", () => {
    expect(joined({ hint: "   " })).not.toContain("PLAYER GUIDANCE");
  });
});

describe("parseGeneratedNote", () => {
  it("reads a plain object", () => {
    expect(
      parseGeneratedNote('{"title":"The Old Well","content":"It is deep.","keywords":["well","water"]}'),
    ).toEqual({
      title: "The Old Well",
      content: "It is deep.",
      keywords: ["well", "water"],
    });
  });

  it("survives fences, preamble and a trailing comma", () => {
    const raw = 'Sure!\n```json\n{ "title": "The Old Well", "content": "Deep.", "keywords": ["well"], }\n```';
    expect(parseGeneratedNote(raw)).toEqual({
      title: "The Old Well",
      content: "Deep.",
      keywords: ["well"],
    });
  });

  it("trims the strings", () => {
    expect(parseGeneratedNote('{"title":"  The Old Well  ","content":"  Deep.  "}')).toEqual({
      title: "The Old Well",
      content: "Deep.",
      keywords: [],
    });
  });

  it("is nothing without a title — the note is left as the player had it", () => {
    expect(parseGeneratedNote('{"content":"Deep."}')).toBeNull();
    expect(parseGeneratedNote('{"title":"   ","content":"Deep."}')).toBeNull();
    expect(parseGeneratedNote('{"title":12,"content":"Deep."}')).toBeNull();
    expect(parseGeneratedNote("I'm afraid I can't do that.")).toBeNull();
    expect(parseGeneratedNote("{ not json at all")).toBeNull();
  });

  it("takes a title without content or keywords — a blank field is not a failure", () => {
    expect(parseGeneratedNote('{"title":"The Old Well"}')).toEqual({
      title: "The Old Well",
      content: "",
      keywords: [],
    });
  });
});

describe("normalizeNoteKeywords", () => {
  it("reads a documented array", () => {
    expect(normalizeNoteKeywords(["well", "water"])).toEqual(["well", "water"]);
  });

  it("reads a comma or newline separated string", () => {
    expect(normalizeNoteKeywords("well, water\naquifer")).toEqual(["well", "water", "aquifer"]);
  });

  it("drops blanks, non-strings and the title, case-insensitively", () => {
    expect(normalizeNoteKeywords(["Well", "", "  ", 12, "the old well"], "The Old Well")).toEqual([
      "Well",
    ]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(normalizeNoteKeywords(["Well", "well", "WELL"])).toEqual(["Well"]);
  });

  it("caps the count", () => {
    const many = Array.from({ length: MAX_NOTE_KEYWORDS + 5 }, (_, i) => `k${i}`);
    expect(normalizeNoteKeywords(many)).toHaveLength(MAX_NOTE_KEYWORDS);
  });

  it("is empty for anything unreadable", () => {
    expect(normalizeNoteKeywords(undefined)).toEqual([]);
    expect(normalizeNoteKeywords(null)).toEqual([]);
    expect(normalizeNoteKeywords({})).toEqual([]);
  });
});
