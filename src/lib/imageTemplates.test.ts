import { describe, it, expect } from "vitest";
import {
  activeTemplate,
  builtinTemplates,
  duplicateTemplate,
  DEFAULT_APPEARANCE_INSTRUCTIONS,
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_PORTRAIT_ACTION,
  DEFAULT_PORTRAIT_COMPOSITION,
  DEFAULT_PORTRAIT_CONTEXT,
  DEFAULT_PORTRAIT_STYLE,
  DEFAULT_REFERENCE_INSTRUCTION,
  newTemplate,
  normalizeImageTemplates,
  PROSE_TEMPLATE_ID,
  TAGS_TEMPLATE_ID,
  TAG_APPEARANCE_INSTRUCTIONS,
  TEMPLATE_TEXT,
} from "./imageTemplates";
import type { Settings } from "../types";

describe("the shipped templates", () => {
  it("ships one of each dialect, prose first", () => {
    const list = builtinTemplates();
    expect(list.map((t) => t.id)).toEqual([PROSE_TEMPLATE_ID, TAGS_TEMPLATE_ID]);
    expect(list.map((t) => t.format)).toEqual(["prose", "tags"]);
  });

  it("hands out fresh copies — editing one must not move the ship text", () => {
    const first = builtinTemplates()[0];
    first.portraitStyle = "clobbered";
    expect(builtinTemplates()[0].portraitStyle).toBe(DEFAULT_PORTRAIT_STYLE);
  });

  it("never mentions pixels — pixelation is client-side post-processing", () => {
    const prompts = [
      ...Object.values(TEMPLATE_TEXT.prose),
      ...Object.values(TEMPLATE_TEXT.tags),
    ];
    for (const p of prompts) expect(p.toLowerCase()).not.toContain("pixel");
  });

  it("style clauses carry no character-specific anatomy or gear language", () => {
    for (const style of [DEFAULT_PORTRAIT_STYLE, TEMPLATE_TEXT.tags.portraitStyle]) {
      for (const word of ["heroic", "pauldron", "gauntlet", "jaw", "bust", "muscul", "armor"]) {
        expect(style.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("the tag dialect asks the narrator for tags, not sentences", () => {
    expect(TAG_APPEARANCE_INSTRUCTIONS).toContain("comma-separated");
    expect(TAG_APPEARANCE_INSTRUCTIONS).toContain("no sentences");
  });
});

describe("normalizeImageTemplates", () => {
  it("falls a missing list back to both built-ins", () => {
    expect(normalizeImageTemplates(undefined)).toEqual(builtinTemplates());
    expect(normalizeImageTemplates("nonsense")).toEqual(builtinTemplates());
    expect(normalizeImageTemplates([])).toEqual(builtinTemplates());
  });

  it("never returns an empty list, whatever the junk inside", () => {
    expect(normalizeImageTemplates([null, 7, "x"])).toEqual(builtinTemplates());
  });

  it("fills a partial stored template from its own dialect's ship text", () => {
    const [t] = normalizeImageTemplates([
      { id: "mine", name: "Mine", format: "tags", portraitStyle: "monochrome" },
    ]);
    expect(t.portraitStyle).toBe("monochrome");
    // Not the PROSE default — the fallback follows the template's own format.
    expect(t.portraitAction).toBe(TEMPLATE_TEXT.tags.portraitAction);
  });

  it("keeps a BLANK field blank — blanking is how a rule is removed", () => {
    const [t] = normalizeImageTemplates([{ id: "m", name: "M", appearanceInstructions: "" }]);
    expect(t.appearanceInstructions).toBe("");
  });

  it("falls an unknown format back to prose rather than storing it", () => {
    const [t] = normalizeImageTemplates([{ id: "m", name: "M", format: "haiku" }]);
    expect(t.format).toBe("prose");
    expect(t.portraitStyle).toBe(DEFAULT_PORTRAIT_STYLE);
  });

  it("drops duplicate ids — two rows fighting over one selection", () => {
    const list = normalizeImageTemplates([
      { id: "m", name: "First" },
      { id: "m", name: "Second" },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("First");
  });

  it("gives an id-less row one, so it can still be selected", () => {
    const [t] = normalizeImageTemplates([{ name: "No id" }]);
    expect(t.id).toBeTruthy();
  });
});

describe("migration off the flat fields", () => {
  it("folds the old wording onto the prose built-in and leaves tags shipped", () => {
    const list = normalizeImageTemplates(undefined, {
      portraitStyle: "My own ink style.",
      appearanceInstructions: "Three vivid clauses.",
      negativePrompt: "blurry",
    });
    const prose = list.find((t) => t.id === PROSE_TEMPLATE_ID)!;
    expect(prose.portraitStyle).toBe("My own ink style.");
    expect(prose.appearanceInstructions).toBe("Three vivid clauses.");
    expect(prose.negativePrompt).toBe("blurry");
    // Untouched fields keep the shipped wording…
    expect(prose.portraitAction).toBe(DEFAULT_PORTRAIT_ACTION);
    expect(prose.portraitContext).toBe(DEFAULT_PORTRAIT_CONTEXT);
    expect(prose.portraitComposition).toBe(DEFAULT_PORTRAIT_COMPOSITION);
    expect(prose.portraitRefInstruction).toBe(DEFAULT_REFERENCE_INSTRUCTION);
    // …and the tag dialect arrives beside it, untouched by the old settings.
    expect(list.find((t) => t.id === TAGS_TEMPLATE_ID)).toEqual(builtinTemplates()[1]);
  });

  it("a player who never edited Advanced sees exactly the shipped wording", () => {
    expect(normalizeImageTemplates(undefined, {})).toEqual(builtinTemplates());
    const prose = normalizeImageTemplates(undefined, {})[0];
    expect(prose.appearanceInstructions).toBe(DEFAULT_APPEARANCE_INSTRUCTIONS);
    expect(prose.negativePrompt).toBe(DEFAULT_NEGATIVE_PROMPT);
  });

  it("ignores the legacy fields once real templates are stored", () => {
    const list = normalizeImageTemplates([{ id: "m", name: "M", portraitStyle: "kept" }], {
      portraitStyle: "stale",
    });
    expect(list[0].portraitStyle).toBe("kept");
  });
});

describe("activeTemplate", () => {
  const settings = (patch: Partial<Settings>) =>
    ({ imageTemplates: builtinTemplates(), imageTemplateId: PROSE_TEMPLATE_ID, ...patch }) as Settings;

  it("resolves the selected id", () => {
    expect(activeTemplate(settings({ imageTemplateId: TAGS_TEMPLATE_ID })).format).toBe("tags");
  });

  it("falls a dangling id back to the first template rather than failing", () => {
    expect(activeTemplate(settings({ imageTemplateId: "deleted-in-another-tab" })).id).toBe(
      PROSE_TEMPLATE_ID,
    );
  });

  it("survives an empty list — there is no state with no way to prompt", () => {
    const t = activeTemplate(settings({ imageTemplates: [], imageTemplateId: "x" }));
    expect(t.id).toBe(PROSE_TEMPLATE_ID);
  });
});

describe("new and duplicated templates", () => {
  it("seeds a new template from its dialect's ship text", () => {
    const t = newTemplate("Mine", "tags");
    expect(t.name).toBe("Mine");
    expect(t.portraitStyle).toBe(TEMPLATE_TEXT.tags.portraitStyle);
  });

  it("a duplicate keeps every word and takes a new id", () => {
    const source = { ...builtinTemplates()[0], portraitStyle: "edited" };
    const copy = duplicateTemplate(source, "Copy");
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("Copy");
    expect(copy.portraitStyle).toBe("edited");
  });

  it("two new templates never collide", () => {
    expect(newTemplate("a", "prose").id).not.toBe(newTemplate("b", "prose").id);
  });
});
