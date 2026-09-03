import { describe, it, expect } from "vitest";
import { collectEntityNames, highlightEntities, highlightWithinQuote } from "./highlight";
import type { Character, Item } from "../types";

function char(overrides: Partial<Character> = {}): Character {
  return {
    id: "c1",
    role: "member",
    name: "Finn",
    species: "human",
    sex: "male",
    description: "",
    personality: "",
    drive: "",
    strengths: "",
    flaws: "",
    notes: "",
    equipment: [],
    ...overrides,
  } as Character;
}

describe("highlightEntities", () => {
  it("passes through plain text with no names and no quotes", () => {
    expect(highlightEntities("just prose", [])).toEqual([{ text: "just prose", kind: "plain" }]);
  });

  it("returns nothing for empty input", () => {
    expect(highlightEntities("", [])).toEqual([]);
  });

  it("highlights a plain entity match", () => {
    expect(highlightEntities("Finn drew his sword", ["Finn"])).toEqual([
      { text: "Finn", kind: "entity" },
      { text: " drew his sword", kind: "plain" },
    ]);
  });

  it("matches item labels with regex-special characters literally", () => {
    expect(highlightEntities("He held the Ring (of Protection) up", ["Ring (of Protection)"])).toEqual([
      { text: "He held the ", kind: "plain" },
      { text: "Ring (of Protection)", kind: "entity" },
      { text: " up", kind: "plain" },
    ]);
  });

  it("is word-boundary anchored — no match inside a longer word", () => {
    const spans = highlightEntities("Happy Anniversary, Ann said hello", ["Ann"]);
    const entities = spans.filter((s) => s.kind === "entity");
    expect(entities).toEqual([{ text: "Ann", kind: "entity" }]);
  });

  it("is case-insensitive", () => {
    expect(highlightEntities("FINN arrived", ["finn"])).toEqual([
      { text: "FINN", kind: "entity" },
      { text: " arrived", kind: "plain" },
    ]);
  });

  it("prefers the longest match at a position", () => {
    expect(highlightEntities("the Rusty Key", ["Key", "Rusty Key"])).toEqual([
      { text: "the ", kind: "plain" },
      { text: "Rusty Key", kind: "entity" },
    ]);
  });

  it("colors a whole quote and bolds an entity inside it via entity-in-quote", () => {
    const spans = highlightEntities('"Take the Rusty Key," said Finn', ["Rusty Key", "Finn"]);
    expect(spans).toEqual([
      { text: '"Take the ', kind: "quote" },
      { text: "Rusty Key", kind: "entity-in-quote" },
      { text: ',"', kind: "quote" },
      { text: " said ", kind: "plain" },
      { text: "Finn", kind: "entity" },
    ]);
  });

  it("detects multiple quoted clauses independently", () => {
    const spans = highlightEntities('"Hi." He paused. "Bye."', []);
    expect(spans.map((s) => s.kind)).toEqual(["quote", "plain", "quote"]);
  });

  it("does not throw on a dangling unbalanced quote mid-stream", () => {
    expect(() => highlightEntities('He said "Hello', ["Finn"])).not.toThrow();
    const spans = highlightEntities('He said "Hello', []);
    expect(spans).toEqual([{ text: 'He said "Hello', kind: "plain" }]);
  });

  it("pairs straight and curly quote glyphs interchangeably", () => {
    const spans = highlightEntities("“Hello there”", []);
    expect(spans).toEqual([{ text: "“Hello there”", kind: "quote" }]);
  });

  it("avoids a double match when one name is a prefix of another", () => {
    const spans = highlightEntities("Finn Ashworth entered", ["Finn", "Finn Ashworth"]);
    expect(spans).toEqual([{ text: "Finn Ashworth", kind: "entity" }, { text: " entered", kind: "plain" }]);
  });

  it("keeps a markdown-like item label as one literal entity span", () => {
    expect(highlightEntities("She wears the Ring of *Protection*", ["Ring of *Protection*"])).toEqual([
      { text: "She wears the ", kind: "plain" },
      { text: "Ring of *Protection*", kind: "entity" },
    ]);
  });
});

describe("collectEntityNames", () => {
  it("includes current character names", () => {
    expect(collectEntityNames([char({ name: "Finn" })], [])).toEqual(["Finn"]);
  });

  it("includes former aliases", () => {
    const names = collectEntityNames([char({ name: "Finn", aliases: ["the Hooded Stranger"] })], []);
    expect(names).toContain("Finn");
    expect(names).toContain("the Hooded Stranger");
  });

  it("includes characters at every standing, not just active", () => {
    const names = collectEntityNames(
      [char({ id: "a", name: "Active" }), char({ id: "b", name: "Departed" }), char({ id: "c", name: "Fallen" })],
      [],
    );
    expect(names).toEqual(["Active", "Departed", "Fallen"]);
  });

  it("includes pack inventory labels and per-character equipment labels", () => {
    const inventory: Item[] = [{ label: "Rusty Key", description: "", quantity: 1 }];
    const withGear = char({ equipment: [{ label: "Iron Sword", description: "" }] });
    expect(collectEntityNames([withGear], inventory)).toEqual(["Finn", "Iron Sword", "Rusty Key"]);
  });

  it("drops blank names and labels", () => {
    const inventory: Item[] = [{ label: "  ", description: "", quantity: 1 }];
    expect(collectEntityNames([char({ name: "  " })], inventory)).toEqual([]);
  });

  it("dedupes by slug across case and punctuation", () => {
    const inventory: Item[] = [
      { label: "the Sword", description: "", quantity: 1 },
      { label: "The Sword", description: "", quantity: 1 },
    ];
    expect(collectEntityNames([], inventory)).toEqual(["the Sword"]);
  });
});

describe("highlightWithinQuote", () => {
  it("treats every match as entity-in-quote", () => {
    expect(highlightWithinQuote("Take the Rusty Key", ["Rusty Key"])).toEqual([
      { text: "Take the ", kind: "plain" },
      { text: "Rusty Key", kind: "entity-in-quote" },
    ]);
  });

  it("passes through plain text with no names", () => {
    expect(highlightWithinQuote("just talk", [])).toEqual([{ text: "just talk", kind: "plain" }]);
  });

  it("is word-boundary anchored", () => {
    const spans = highlightWithinQuote("Anniversary Ann", ["Ann"]);
    expect(spans.filter((s) => s.kind === "entity-in-quote")).toEqual([
      { text: "Ann", kind: "entity-in-quote" },
    ]);
  });
});
