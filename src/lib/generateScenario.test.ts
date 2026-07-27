import { describe, it, expect } from "vitest";
import {
  SCENARIO_FIELDS,
  SCENARIO_FIELD_LABEL,
  buildScenarioMessages,
  scenarioScanText,
  type ScenarioField,
} from "./generateScenario";
import { parseGeneratedField } from "./generateField";
import { defaultPC, newGame } from "./defaults";
import type { Character, GameState, Note, Scenario } from "../types";

function gameWith(patch: Partial<Scenario> = {}, notes: Note[] = []): GameState {
  const game = newGame();
  return { ...game, scenario: { ...game.scenario, ...patch }, worldNotes: notes };
}

function note(patch: Partial<Note> & { id: string; title: string }): Note {
  return { content: "", keywords: [], permanent: false, ...patch };
}

function joined(
  field: ScenarioField,
  opts: { game?: GameState; characters?: Character[]; hint?: string } = {},
) {
  return buildScenarioMessages({
    game: opts.game ?? gameWith(),
    characters: opts.characters ?? [defaultPC()],
    field,
    hint: opts.hint,
  })
    .map((m) => m.content)
    .join("\n");
}

describe("buildScenarioMessages — field isolation", () => {
  it("names only the requested field's key and rule", () => {
    const premise = joined("premise");
    expect(premise).toContain('"premise"');
    // The model must never be told about a field it isn't writing.
    expect(premise).not.toContain('"openingNarration"');

    const opening = joined("openingNarration");
    expect(opening).toContain('"openingNarration"');
    expect(opening).not.toContain('key, "premise"');
  });

  it("sends the other fields as context, but not the one being replaced", () => {
    const game = gameWith({
      title: "Legend of Mesmeria",
      premise: "A premise about airships.",
      openingNarration: "You wake on a moving deck.",
    });
    const premise = joined("premise", { game });
    expect(premise).toContain("You wake on a moving deck.");
    // The draft being replaced is not context — it is what we are throwing away.
    expect(premise).not.toContain("A premise about airships.");
    expect(premise).toContain("Legend of Mesmeria");

    const opening = joined("openingNarration", { game });
    expect(opening).toContain("A premise about airships.");
    expect(opening).not.toContain("You wake on a moving deck.");
  });

  it("has a rule and a label for every field", () => {
    for (const field of SCENARIO_FIELDS) {
      expect(SCENARIO_FIELD_LABEL[field]).toBeTruthy();
      expect(joined(field)).toContain(SCENARIO_FIELD_LABEL[field]);
    }
  });
});

describe("buildScenarioMessages — context", () => {
  it("carries the player character, so the opening has someone to write about", () => {
    const pc = { ...defaultPC(), name: "Hiro", drive: "Become the greatest adventurer" };
    const text = joined("openingNarration", { characters: [pc] });
    expect(text).toContain("Hiro");
    expect(text).toContain("Become the greatest adventurer");
  });

  it("works with no player character at all", () => {
    expect(() => joined("premise", { characters: [] })).not.toThrow();
  });

  it("pulls in the World Notes the scenario's own words trigger", () => {
    const game = gameWith({ premise: "The Sunken Choir still sings under the harbour." }, [
      note({ id: "n1", title: "Sunken Choir", content: "Drowned singers, not ghosts." }),
      note({ id: "n2", title: "Ironhold", content: "A dwarven city far inland." }),
    ]);
    // Written for the opening, so the premise IS the scan text.
    const text = joined("openingNarration", { game });
    expect(text).toContain("Drowned singers, not ghosts.");
    expect(text).not.toContain("A dwarven city far inland.");
  });

  it("never reads the story's beats — this is what a NEW adventure starts from", () => {
    const game = gameWith();
    const text = joined(
      "premise",
      {
        game: {
          ...game,
          messages: [
            { id: "m1", role: "narrator", content: "A goblin steals your boots.", turn: 1 },
          ],
        },
      },
    );
    expect(text).not.toContain("A goblin steals your boots.");
  });
});

describe("buildScenarioMessages — guidance", () => {
  it("omits the guidance block when there is none", () => {
    expect(joined("premise")).not.toContain("PLAYER GUIDANCE");
    expect(joined("premise", { hint: "   " })).not.toContain("PLAYER GUIDANCE");
  });

  it("puts the hint last, so it outranks the scenario it may contradict", () => {
    const messages = buildScenarioMessages({
      game: gameWith(),
      characters: [defaultPC()],
      field: "premise",
      hint: "make it undersea",
    });
    const idx = messages.findIndex((m) => m.content.includes("make it undersea"));
    expect(idx).toBe(messages.length - 2); // the user "emit it now" line is last
    expect(messages[messages.length - 1].role).toBe("user");
  });

  it("scans the hint for World Notes too", () => {
    const game = gameWith({ premise: "", openingNarration: "", title: "" }, [
      note({ id: "n1", title: "Sunken Choir", content: "Drowned singers, not ghosts." }),
    ]);
    expect(scenarioScanText(game, "start them at the Sunken Choir")).toContain("Sunken Choir");
    expect(joined("premise", { game, hint: "start them at the Sunken Choir" })).toContain(
      "Drowned singers, not ghosts.",
    );
  });
});

describe("parseGeneratedField — scenario keys", () => {
  it("reads the same one-key JSON the character fields use", () => {
    expect(parseGeneratedField('{"premise": "  A drowned empire.  "}', "premise")).toBe(
      "A drowned empire.",
    );
    expect(
      parseGeneratedField('```json\n{"openingNarration": "You wake."}\n```', "openingNarration"),
    ).toBe("You wake.");
  });

  it("reads a reply for the wrong field as nothing", () => {
    expect(parseGeneratedField('{"premise": "A drowned empire."}', "openingNarration")).toBe("");
    expect(parseGeneratedField("sorry, I can't help with that", "premise")).toBe("");
  });
});
