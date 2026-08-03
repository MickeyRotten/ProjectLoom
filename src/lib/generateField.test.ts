import { describe, it, expect } from "vitest";
import {
  GEN_FIELDS,
  buildFieldMessages,
  fieldScanText,
  parseGeneratedField,
  type GenField,
} from "./generateField";
import { defaultSettings, newCharacter, newGame } from "./defaults";
import { builtinTemplates } from "./imageTemplates";
import type { Character, GameState, Note, Settings } from "../types";

function member(patch: Partial<Character> = {}): Character {
  return {
    ...newCharacter("m1"),
    name: "Elara",
    species: "elf",
    sex: "female",
    ...patch,
  };
}

function gameWith(notes: Note[] = []): GameState {
  return { ...newGame(), worldNotes: notes };
}

function note(patch: Partial<Note> & { id: string; title: string }): Note {
  return { content: "", keywords: [], permanent: false, ...patch };
}

function joined(
  field: GenField,
  opts: {
    character?: Character;
    game?: GameState;
    settings?: Partial<Settings>;
    hint?: string;
  } = {},
) {
  return buildFieldMessages({
    game: opts.game ?? gameWith(),
    settings: { ...defaultSettings(), ...opts.settings },
    character: opts.character ?? member(),
    field,
    hint: opts.hint,
  })
    .map((m) => m.content)
    .join("\n");
}

/** Settings whose selected image template carries this appearance rule. */
function appearanceRule(text: string): Partial<Settings> {
  const [prose, ...rest] = builtinTemplates();
  return {
    imageTemplates: [{ ...prose, appearanceInstructions: text }, ...rest],
    imageTemplateId: prose.id,
  };
}

describe("buildFieldMessages — field isolation", () => {
  it("names only the requested field as the JSON key", () => {
    const text = joined("flaws");
    expect(text).toContain('exactly one key, "flaws"');
    expect(text).toContain("Write ONLY Flaws.");
    expect(text).toContain("Write only: Flaws.");
  });

  it("sends only the requested field's rule", () => {
    const text = joined("strengths");
    expect(text).toContain('"strengths" is what this character is genuinely good at');
    expect(text).not.toContain('"flaws" is what this character is bad at');
    expect(text).not.toContain('"drive" is the ONE thing');
  });

  it("uses the SELECTED template's appearance sentence as the Appearance rule", () => {
    const text = joined("description", {
      settings: appearanceRule("Appearance is a woodcut, four words."),
    });
    expect(text).toContain("Appearance is a woodcut, four words.");
  });

  it("falls a blanked appearance sentence back to the built-in", () => {
    const text = joined("description", { settings: appearanceRule("   ") });
    expect(text).toContain('"description" is physical appearance only, concrete and visual.');
  });

  it("asks for every field it offers", () => {
    for (const field of GEN_FIELDS) {
      expect(joined(field)).toContain(`exactly one key, "${field}"`);
    }
  });
});

describe("buildFieldMessages — context", () => {
  it("carries species and sex on the sheet's identity line", () => {
    expect(joined("personality")).toContain("CURRENT SHEET — Elara (elf, female)");
  });

  it("fixes species and sex against contradiction", () => {
    expect(joined("personality")).toContain("Species and Sex are FIXED");
  });

  it("names only the traits that are actually filled in", () => {
    const text = joined("personality", { character: member({ sex: "" }) });
    expect(text).toContain("Species is FIXED");
    expect(text).not.toContain("Sex");
  });

  it("drops the fixed-traits rule when neither is set", () => {
    const text = joined("personality", { character: member({ species: "", sex: "" }) });
    expect(text).not.toContain("FIXED");
  });

  it("includes the scenario", () => {
    expect(joined("drive")).toContain("SCENARIO — ");
  });

  it("omits the scenario block when the scenario is blank", () => {
    const game = { ...gameWith(), scenario: { ...newGame().scenario, title: "", premise: "" } };
    expect(joined("drive", { game })).not.toContain("SCENARIO —");
  });

  it("shows the other sheet fields as constraints", () => {
    const text = joined("flaws", {
      character: member({ personality: "Wry and watchful.", drive: "Find her brother." }),
    });
    expect(text).toContain("Personality: Wry and watchful.");
    expect(text).toContain("Drive: Find her brother.");
  });

  it("never reads the story", () => {
    const game = {
      ...gameWith(),
      messages: [{ id: "n1", role: "narrator" as const, content: "Elara betrays you.", turn: 1 }],
    };
    expect(joined("personality", { game })).not.toContain("Elara betrays you.");
  });
});

describe("buildFieldMessages — world notes", () => {
  const notes = [
    note({ id: "w1", title: "Sylvan Elves", content: "Bound to the old groves." }),
    note({ id: "w2", title: "Dwarven Holds", content: "Sealed since the flood." }),
  ];

  it("injects a note the character's own fields trigger", () => {
    const text = joined("personality", {
      game: gameWith(notes),
      character: member({ description: "Raised among the Sylvan Elves." }),
    });
    expect(text).toContain("Bound to the old groves.");
    expect(text).not.toContain("Sealed since the flood.");
  });

  it("injects a note the hint triggers", () => {
    const text = joined("drive", {
      game: gameWith(notes),
      hint: "tie her to the Dwarven Holds",
    });
    expect(text).toContain("Sealed since the flood.");
  });

  it("emits no notes block when nothing matches", () => {
    expect(joined("drive", { game: gameWith(notes) })).not.toContain("WORLD NOTES");
  });
});

describe("buildFieldMessages — player guidance", () => {
  it("adds the hint as its own block, last before the ask", () => {
    const messages = buildFieldMessages({
      game: gameWith(),
      settings: defaultSettings(),
      character: member(),
      field: "flaws",
      hint: "make it cost her the party's trust",
    });
    const guidance = messages.findIndex((m) => m.content.startsWith("PLAYER GUIDANCE"));
    expect(guidance).toBeGreaterThan(0);
    expect(guidance).toBe(messages.length - 2);
    expect(messages[guidance].content).toContain("make it cost her the party's trust");
    expect(messages[messages.length - 1].role).toBe("user");
  });

  it("omits the guidance block for a blank hint", () => {
    expect(joined("flaws", { hint: "   " })).not.toContain("PLAYER GUIDANCE");
  });
});

describe("fieldScanText", () => {
  it("gathers identity, every sheet field and the equipment", () => {
    const text = fieldScanText(
      member({
        drive: "Find her brother.",
        equipment: [{ label: "Yew Bow", description: "Her mother's." }],
      }),
      "a hint",
    );
    expect(text).toContain("Elara");
    expect(text).toContain("elf");
    expect(text).toContain("female");
    expect(text).toContain("Find her brother.");
    expect(text).toContain("Yew Bow");
    expect(text).toContain("Her mother's.");
    expect(text).toContain("a hint");
  });

  it("survives a legacy character with no equipment array", () => {
    const legacy = { ...member(), equipment: undefined } as unknown as Character;
    expect(() => fieldScanText(legacy)).not.toThrow();
  });
});

describe("parseGeneratedField", () => {
  it("reads the field out of a bare object", () => {
    expect(parseGeneratedField('{"drive":"Find her brother."}', "drive")).toBe(
      "Find her brother.",
    );
  });

  it("survives fences, preamble and a trailing comma", () => {
    const raw = 'Sure!\n```json\n{ "flaws": "Trusts too fast.", }\n```';
    expect(parseGeneratedField(raw, "flaws")).toBe("Trusts too fast.");
  });

  it("trims the value", () => {
    expect(parseGeneratedField('{"drive":"  Go home.  "}', "drive")).toBe("Go home.");
  });

  it("ignores a field it did not ask for", () => {
    expect(parseGeneratedField('{"drive":"Go home."}', "flaws")).toBe("");
  });

  it("returns nothing rather than blanking the field", () => {
    expect(parseGeneratedField('{"flaws":"   "}', "flaws")).toBe("");
    expect(parseGeneratedField('{"flaws":null}', "flaws")).toBe("");
    expect(parseGeneratedField('{"flaws":42}', "flaws")).toBe("");
    expect(parseGeneratedField('{"flaws":["a"]}', "flaws")).toBe("");
    expect(parseGeneratedField("I cannot help with that.", "flaws")).toBe("");
    expect(parseGeneratedField("", "flaws")).toBe("");
  });
});
