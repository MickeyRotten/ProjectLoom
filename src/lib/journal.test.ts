import { describe, it, expect } from "vitest";
import type { Character, GameState, JournalEntry, Message, Settings } from "../types";
import { defaultSettings, newCharacter, newGame } from "./defaults";
import { formatJournalBlock, JOURNAL_PROSE_ENTRIES } from "./prompt";
import {
  JOURNAL_MAX_LINES,
  appendModelLines,
  buildJournalMessages,
  milestoneLines,
  nextFromTurn,
  openJournalEntry,
  parseJournalLines,
  shouldJournal,
} from "./journal";

function settings(patch: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), journalMinTurns: 4, journalMaxTurns: 30, ...patch };
}

function beat(turn: number, patch: Partial<Message> = {}): Message {
  return { id: `m-${turn}`, role: "narrator", content: `beat ${turn}`, turn, ...patch };
}

function game(patch: Partial<GameState> = {}): GameState {
  return { ...newGame(), ...patch };
}

const cast = (): Character[] => [{ ...newCharacter("c-1"), name: "Bren" }];

function entry(patch: Partial<JournalEntry> = {}): JournalEntry {
  return { id: "j-1", day: 1, fromTurn: 1, throughTurn: 5, lines: [], ...patch };
}

describe("nextFromTurn", () => {
  it("starts at turn 1 on a fresh adventure", () => {
    expect(nextFromTurn([])).toBe(1);
  });

  it("picks up one past the last entry", () => {
    expect(nextFromTurn([entry({ throughTurn: 12 })])).toBe(13);
  });
});

describe("shouldJournal", () => {
  const opts = (patch: Partial<Parameters<typeof shouldJournal>[0]> = {}) => ({
    game: game(),
    settings: settings(),
    characters: cast(),
    turn: 10,
    day: 2,
    rested: true,
    ...patch,
  });

  it("fires on a night's rest that lands in a new day", () => {
    expect(shouldJournal(opts())).toBe(true);
  });

  it("does not fire on an ordinary turn", () => {
    expect(shouldJournal(opts({ rested: false }))).toBe(false);
  });

  it("stays quiet below the floor — a day crossed on turn two is not a day", () => {
    expect(shouldJournal(opts({ turn: 2 }))).toBe(false);
  });

  it("fires on the turn ceiling even though nobody slept", () => {
    // The player who never sleeps still needs their memory caught.
    expect(shouldJournal(opts({ turn: 30, rested: false }))).toBe(true);
  });

  it("does not fire on a rest that stays inside the same day", () => {
    const g = game({ journal: [entry({ day: 4, throughTurn: 3 })] });
    expect(shouldJournal(opts({ game: g, day: 4 }))).toBe(false);
  });

  it("is off entirely when the setting is off", () => {
    expect(shouldJournal(opts({ settings: settings({ journalEnabled: false }) }))).toBe(false);
  });
});

describe("openJournalEntry", () => {
  const base = {
    settings: settings(),
    characters: cast(),
    turn: 10,
    day: 2,
    rested: true,
  };

  it("returns the SAME array when no boundary was crossed", () => {
    const g = game({ messages: [beat(1)] });
    expect(openJournalEntry({ ...base, game: g, rested: false })).toBe(g.journal);
  });

  it("opens an entry covering the interval since the last one", () => {
    const g = game({
      journal: [entry({ throughTurn: 4 })],
      messages: [beat(5, { day: 1 }), beat(10, { day: 2 })],
    });
    const journal = openJournalEntry({ ...base, game: g });
    expect(journal).toHaveLength(2);
    expect(journal[1].fromTurn).toBe(5);
    expect(journal[1].throughTurn).toBe(10);
  });

  it("dates an entry by the day it STARTED, not the one it ended in", () => {
    // An interval that spans a midnight belongs to the day being lived.
    const g = game({ messages: [beat(1, { day: 1 }), beat(10, { day: 2 })] });
    expect(openJournalEntry({ ...base, game: g })[0].day).toBe(1);
  });

  it("opens with its facts already in place and no written lines", () => {
    const g = game({
      messages: [
        beat(3, { appliedDeltas: { quests: [{ op: "update", label: "The Salt Road", status: "done" }] } }),
        beat(10),
      ],
    });
    const [opened] = openJournalEntry({ ...base, game: g });
    expect(opened.lines).toEqual([{ text: "Completed: The Salt Road.", source: "system" }]);
  });
});

describe("milestoneLines", () => {
  it("reads the cast, quests and marks off the recorded blocks", () => {
    const messages = [
      beat(1, { appliedDeltas: { party: [{ op: "add", name: "bren" }] } }),
      beat(2, { appliedDeltas: { quests: [{ op: "add", label: "Find the well" }] } }),
      beat(3, {
        appliedDeltas: { conditions: [{ name: "Bren", condition: "left arm in a sling" }] },
      }),
      beat(4, { appliedDeltas: { party: [{ op: "remove", name: "Bren" }] } }),
    ];
    expect(milestoneLines(messages, 1, 4, cast()).map((l) => l.text)).toEqual([
      "Bren joined.",
      "Took on: Find the well.",
      "Bren: left arm in a sling.",
      "Bren left.",
    ]);
  });

  it("uses the library's spelling of a name the block slugged differently", () => {
    const messages = [beat(1, { appliedDeltas: { party: [{ op: "add", name: "  bREN " }] } })];
    expect(milestoneLines(messages, 1, 1, cast())[0].text).toBe("Bren joined.");
  });

  it("reports a move only when the place actually changed", () => {
    const messages = [
      beat(1, { location: "Murkwood" }),
      beat(2, { location: "Murkwood" }),
      beat(3, { location: "Rodstroke" }),
    ];
    expect(milestoneLines(messages, 1, 3, cast()).map((l) => l.text)).toEqual([
      "Travelled to Rodstroke.",
    ]);
  });

  it("ignores turns outside the interval", () => {
    const messages = [
      beat(1, { appliedDeltas: { quests: [{ op: "add", label: "Early" }] } }),
      beat(9, { appliedDeltas: { quests: [{ op: "add", label: "Inside" }] } }),
      beat(20, { appliedDeltas: { quests: [{ op: "add", label: "Late" }] } }),
    ];
    expect(milestoneLines(messages, 5, 12, cast()).map((l) => l.text)).toEqual([
      "Took on: Inside.",
    ]);
  });

  it("does not repeat a line the narrator restated across beats", () => {
    const messages = [
      beat(1, { appliedDeltas: { quests: [{ op: "add", label: "Find the well" }] } }),
      beat(2, { appliedDeltas: { quests: [{ op: "add", label: "Find the well" }] } }),
    ];
    expect(milestoneLines(messages, 1, 2, cast())).toHaveLength(1);
  });
});

describe("appendModelLines", () => {
  it("appends written lines after the facts", () => {
    const journal = [entry({ lines: [{ text: "Bren joined.", source: "system" }] })];
    const next = appendModelLines(journal, "j-1", ["Crossed the marsh at dusk."]);
    expect(next[0].lines).toEqual([
      { text: "Bren joined.", source: "system" },
      { text: "Crossed the marsh at dusk.", source: "model" },
    ]);
  });

  it("no-ops on an id that is gone — undo must win the race", () => {
    const journal = [entry()];
    expect(appendModelLines(journal, "j-missing", ["anything"])).toBe(journal);
  });

  it("no-ops on an empty result", () => {
    const journal = [entry()];
    expect(appendModelLines(journal, "j-1", [])).toBe(journal);
  });
});

describe("parseJournalLines", () => {
  it("reads a plain object", () => {
    expect(parseJournalLines('{"lines":["Crossed the marsh.","Lost the mule."]}')).toEqual([
      "Crossed the marsh.",
      "Lost the mule.",
    ]);
  });

  it("digs the object out of surrounding chatter and fences", () => {
    const raw = 'Sure!\n```json\n{ "lines": ["Refused the ferryman."] }\n```';
    expect(parseJournalLines(raw)).toEqual(["Refused the ferryman."]);
  });

  it("drops anything that is not a usable string", () => {
    expect(parseJournalLines('{"lines":["Kept.", 7, null, "  ", {"x":1}]}')).toEqual(["Kept."]);
  });

  it("caps the line count", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    expect(parseJournalLines(JSON.stringify({ lines }))).toHaveLength(JOURNAL_MAX_LINES);
  });

  it("yields nothing for a reply with no object or no array", () => {
    expect(parseJournalLines("no json here")).toEqual([]);
    expect(parseJournalLines('{"lines":"a string"}')).toEqual([]);
  });
});

describe("buildJournalMessages", () => {
  it("hands over the facts and forbids repeating them", () => {
    const g = game({ messages: [beat(1), beat(2)] });
    const e = entry({ fromTurn: 1, throughTurn: 2, lines: [{ text: "Bren joined.", source: "system" }] });
    const text = buildJournalMessages(settings(), g, e)
      .map((m) => m.content)
      .join("\n");
    expect(text).toContain("Bren joined.");
    expect(text).toContain("do not repeat");
  });

  it("sends only the interval's beats", () => {
    const g = game({ messages: [beat(1), beat(2), beat(9)] });
    const text = buildJournalMessages(settings(), g, entry({ fromTurn: 1, throughTurn: 2 }))
      .map((m) => m.content)
      .join("\n");
    expect(text).toContain("beat 2");
    expect(text).not.toContain("beat 9");
  });
});

describe("formatJournalBlock", () => {
  const withLines = (id: string, day: number, n: number) =>
    entry({
      id,
      day,
      lines: [
        { text: `fact ${id}`, source: "system" as const },
        ...Array.from({ length: n }, (_, i) => ({
          text: `written ${id} ${i}`,
          source: "model" as const,
        })),
      ],
    });

  it("is empty with no entries or no budget", () => {
    expect(formatJournalBlock([], 999)).toBe("");
    expect(formatJournalBlock([withLines("a", 1, 1)], 0)).toBe("");
  });

  it("lists newest first", () => {
    const block = formatJournalBlock([withLines("a", 1, 1), withLines("b", 2, 1)], 9999);
    expect(block.indexOf("Day 2")).toBeLessThan(block.indexOf("Day 1"));
  });

  it("decays older entries to their facts", () => {
    const entries = Array.from({ length: JOURNAL_PROSE_ENTRIES + 1 }, (_, i) =>
      withLines(`e${i}`, i + 1, 1),
    );
    const block = formatJournalBlock(entries, 9999);
    // The oldest keeps its fact and loses its written line.
    expect(block).toContain("fact e0");
    expect(block).not.toContain("written e0 0");
    expect(block).toContain("written e4 0");
  });

  it("stops at the budget", () => {
    const entries = Array.from({ length: 40 }, (_, i) => withLines(`e${i}`, i + 1, 3));
    const small = formatJournalBlock(entries, 120);
    const large = formatJournalBlock(entries, 4000);
    expect(small.length).toBeLessThan(large.length);
    expect(small).toContain("Day 40");
  });
});
