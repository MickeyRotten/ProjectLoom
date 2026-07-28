import { describe, it, expect } from "vitest";
import {
  MAX_ITEM_QUANTITY,
  buildItemMessages,
  formatPackBlock,
  itemScanText,
  normalizeItemQuantity,
  parseGeneratedItem,
  type ItemRow,
} from "./generateItem";
import { defaultPC, newGame } from "./defaults";
import type { Character, GameState, Note } from "../types";

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
  opts: { game?: GameState; existing?: ItemRow[]; character?: Character; hint?: string } = {},
) {
  return buildItemMessages({
    game: opts.game ?? gameWith(),
    existing: opts.existing ?? [],
    character: opts.character,
    hint: opts.hint,
  })
    .map((m) => m.content)
    .join("\n");
}

describe("buildItemMessages — the contract", () => {
  it("asks for all three keys in one object", () => {
    const text = joined();
    expect(text).toContain('"label"');
    expect(text).toContain('"description"');
    expect(text).toContain('"quantity"');
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
          {
            id: "m1",
            role: "narrator",
            content: "The bosun handed you a tarnished spyglass.",
            turn: 3,
          },
        ],
      },
    });
    expect(text).not.toContain("tarnished spyglass");
  });
});

describe("buildItemMessages — pack vs kit", () => {
  const pack: ItemRow[] = [
    { label: "Rope", description: "Forty feet of it.", quantity: 1 },
    { label: "Arrow", description: "Fletched grey.", quantity: 12 },
  ];

  it("lists what the party carries, counts and all, for the shared pack", () => {
    const text = joined({ existing: pack });
    expect(text).toContain("ALREADY IN THE PACK");
    expect(text).toContain("Rope: Forty feet of it.");
    expect(text).toContain("Arrow ×12: Fletched grey.");
    expect(text).toContain("Do not write anything already listed below");
    expect(text).toContain("Write one item for the pack.");
  });

  it("says so plainly when the pack is empty", () => {
    expect(formatPackBlock([])).toBe("ALREADY IN THE PACK — nothing yet.");
    expect(formatPackBlock([{ label: "  ", description: "" }])).toBe(
      "ALREADY IN THE PACK — nothing yet.",
    );
  });

  it("sends the character's sheet, and their kit inside it, for equipment", () => {
    const pc: Character = {
      ...defaultPC(),
      name: "Sable",
      species: "human",
      description: "A wiry courier in a salt-stained coat.",
      equipment: [],
    };
    const text = joined({ character: pc, existing: pack });

    expect(text).toContain("CURRENT SHEET");
    expect(text).toContain("A wiry courier in a salt-stained coat.");
    // The kit is the sheet's EQUIPMENT list, not a second copy beside it: two
    // lists of the same gear read as two sets of gear.
    expect(text).toContain("Arrow ×12: Fletched grey.");
    expect(text).not.toContain("ALREADY IN THE PACK");
    expect(text).toContain("read their sheet below");
    expect(text).toContain("Write one item for Sable to carry.");
  });

  it("shows the kit as the draft has it, blank rows dropped", () => {
    const pc: Character = {
      ...defaultPC(),
      name: "Sable",
      // What was SAVED — the prompt must show the draft instead.
      equipment: [{ label: "Stale Bread", description: "" }],
    };
    const text = joined({
      character: pc,
      existing: [
        { label: "Lantern", description: "Whale oil." },
        { label: "", description: "" },
      ],
    });
    expect(text).toContain("Lantern: Whale oil.");
    expect(text).not.toContain("Stale Bread");
  });
});

describe("buildItemMessages — notes and guidance", () => {
  it("pulls in the world notes the item's own words touch", () => {
    const notes = [
      note({ id: "n1", title: "Ashen Legion", content: "Mercenaries in grey.", keywords: ["legion"] }),
      note({ id: "n2", title: "Sunken Choir", content: "Drowned singers.", keywords: ["choir"] }),
    ];
    const text = joined({
      game: gameWith(notes),
      existing: [{ label: "Legion Banner", description: "Torn." }],
    });
    expect(text).toContain("Mercenaries in grey.");
    expect(text).not.toContain("Drowned singers.");
  });

  it("matches notes on the player's guidance too", () => {
    const notes = [
      note({ id: "n1", title: "Sunken Choir", content: "Drowned singers.", keywords: ["choir"] }),
    ];
    const text = joined({ game: gameWith(notes), hint: "something the choir left behind" });
    expect(text).toContain("Drowned singers.");
  });

  it("puts the guidance last, so it outranks the pack it may contradict", () => {
    const messages = buildItemMessages({
      game: gameWith(),
      existing: [{ label: "Rope", description: "Forty feet." }],
      hint: "a second, better rope",
    });
    const guidance = messages.findIndex((m) => m.content.startsWith("PLAYER GUIDANCE"));
    const pack = messages.findIndex((m) => m.content.startsWith("ALREADY IN THE PACK"));
    expect(guidance).toBeGreaterThan(pack);
    // Only the closing user turn comes after it.
    expect(messages[guidance + 1].role).toBe("user");
  });

  it("adds nothing at all when there is no guidance", () => {
    expect(joined({ hint: "   " })).not.toContain("PLAYER GUIDANCE");
  });
});

describe("itemScanText", () => {
  it("reads the hint, the rows and who is carrying them — never the story", () => {
    const pc: Character = { ...defaultPC(), name: "Sable", species: "human" };
    const text = itemScanText([{ label: "Rope", description: "Forty feet." }], pc, "a lantern");
    expect(text).toContain("a lantern");
    expect(text).toContain("Rope");
    expect(text).toContain("Sable");
    expect(text).toContain("human");
  });

  it("survives a bare pack with no character and no hint", () => {
    expect(itemScanText([])).toBe("");
  });
});

describe("parseGeneratedItem", () => {
  it("reads a plain object", () => {
    expect(parseGeneratedItem('{"label":"Rope","description":"Forty feet.","quantity":1}')).toEqual({
      label: "Rope",
      description: "Forty feet.",
      quantity: 1,
    });
  });

  it("survives fences, preamble and a trailing comma", () => {
    const raw = 'Sure!\n```json\n{ "label": "Arrow", "description": "Grey.", "quantity": 12, }\n```';
    expect(parseGeneratedItem(raw)).toEqual({
      label: "Arrow",
      description: "Grey.",
      quantity: 12,
    });
  });

  it("trims the strings", () => {
    expect(parseGeneratedItem('{"label":"  Rope  ","description":"  Forty feet.  "}')).toEqual({
      label: "Rope",
      description: "Forty feet.",
      quantity: 1,
    });
  });

  it("is nothing without a label — the row is left as the player had it", () => {
    expect(parseGeneratedItem('{"description":"Forty feet."}')).toBeNull();
    expect(parseGeneratedItem('{"label":"   ","description":"Forty feet."}')).toBeNull();
    expect(parseGeneratedItem('{"label":12,"description":"Forty feet."}')).toBeNull();
    expect(parseGeneratedItem("I'm afraid I can't do that.")).toBeNull();
    expect(parseGeneratedItem("{ not json at all")).toBeNull();
  });

  it("takes a label without a description — a blank field is not a failure", () => {
    expect(parseGeneratedItem('{"label":"Rope"}')).toEqual({
      label: "Rope",
      description: "",
      quantity: 1,
    });
  });
});

describe("normalizeItemQuantity", () => {
  it("defaults to one for anything unreadable", () => {
    expect(normalizeItemQuantity(undefined)).toBe(1);
    expect(normalizeItemQuantity(null)).toBe(1);
    expect(normalizeItemQuantity("a few")).toBe(1);
    expect(normalizeItemQuantity(NaN)).toBe(1);
    expect(normalizeItemQuantity({})).toBe(1);
  });

  it("reads a number written as a string", () => {
    expect(normalizeItemQuantity("12")).toBe(12);
    expect(normalizeItemQuantity(" 3 ")).toBe(3);
  });

  it("floors fractions and pins the range", () => {
    expect(normalizeItemQuantity(2.7)).toBe(2);
    expect(normalizeItemQuantity(0)).toBe(1);
    expect(normalizeItemQuantity(-5)).toBe(1);
    // A model answering with a year or a price must not become the count.
    expect(normalizeItemQuantity(1499)).toBe(MAX_ITEM_QUANTITY);
    expect(normalizeItemQuantity(Infinity)).toBe(1);
  });
});
