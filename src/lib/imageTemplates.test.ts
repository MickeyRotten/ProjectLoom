import { describe, it, expect } from "vitest";
import {
  activeTemplate,
  APPEARANCE_BLOCK_ID,
  builtinTemplates,
  duplicateTemplate,
  DEFAULT_APPEARANCE_INSTRUCTIONS,
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_PORTRAIT_ACTION,
  DEFAULT_PORTRAIT_COMPOSITION,
  DEFAULT_PORTRAIT_CONTEXT,
  DEFAULT_PORTRAIT_STYLE,
  DEFAULT_REFERENCE_INSTRUCTION,
  makeImagePromptBlock,
  moveImagePromptBlock,
  newTemplate,
  normalizeImageTemplates,
  PORTRAIT_ACTION_BLOCK_ID,
  PORTRAIT_STYLE_BLOCK_ID,
  PROSE_TEMPLATE_ID,
  TAGS_TEMPLATE_ID,
  TAG_APPEARANCE_INSTRUCTIONS,
  TEMPLATE_TEXT,
} from "./imageTemplates";
import type { ImagePromptTextBlock, Settings } from "../types";

/** The text of a named text block, "" if absent or not a text block. */
function blockText(t: ReturnType<typeof builtinTemplates>[number], id: string): string {
  const b = t.blocks.find((x) => x.id === id);
  return b && b.type === "text" ? b.text : "";
}

describe("the shipped templates", () => {
  it("ships one of each dialect, prose first", () => {
    const list = builtinTemplates();
    expect(list.map((t) => t.id)).toEqual([PROSE_TEMPLATE_ID, TAGS_TEMPLATE_ID]);
    expect(list.map((t) => t.format)).toEqual(["prose", "tags"]);
  });

  it("leads with the Appearance block by default", () => {
    for (const t of builtinTemplates()) {
      expect(t.blocks[0]).toEqual({ id: APPEARANCE_BLOCK_ID, type: "appearance" });
    }
  });

  it("carries exactly one Appearance block, the rest text", () => {
    for (const t of builtinTemplates()) {
      expect(t.blocks.filter((b) => b.type === "appearance")).toHaveLength(1);
      expect(t.blocks.filter((b) => b.type === "text")).toHaveLength(4);
    }
  });

  it("hands out fresh copies — editing one must not move the ship text", () => {
    const first = builtinTemplates()[0];
    (first.blocks.find((b) => b.id === PORTRAIT_STYLE_BLOCK_ID) as ImagePromptTextBlock).text =
      "clobbered";
    expect(blockText(builtinTemplates()[0], PORTRAIT_STYLE_BLOCK_ID)).toBe(DEFAULT_PORTRAIT_STYLE);
  });

  it("the prose style clause asks for pixel art", () => {
    expect(DEFAULT_PORTRAIT_STYLE.toLowerCase()).toContain("pixel");
  });

  it("the tag dialect asks the narrator for tags, not sentences", () => {
    expect(TAG_APPEARANCE_INSTRUCTIONS).toContain("comma-separated");
    expect(TAG_APPEARANCE_INSTRUCTIONS).toContain("no sentences");
  });
});

describe("block editing", () => {
  it("makes a fresh, blank, uniquely-id'd text block", () => {
    const a = makeImagePromptBlock();
    const b = makeImagePromptBlock();
    expect(a).toMatchObject({ type: "text", title: "", text: "" });
    expect(a.id).not.toBe(b.id);
  });

  it("moves a block within the list, clamped at the ends", () => {
    const blocks = builtinTemplates()[0].blocks;
    const moved = moveImagePromptBlock(blocks, 1, -1);
    expect(moved[0]).toEqual(blocks[1]);
    expect(moved[1]).toEqual(blocks[0]);
    // Out of range: same reference back.
    expect(moveImagePromptBlock(blocks, 0, -1)).toBe(blocks);
    expect(moveImagePromptBlock(blocks, blocks.length - 1, 1)).toBe(blocks);
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

  it("keeps a stored block list, validated row by row", () => {
    const [t] = normalizeImageTemplates([
      {
        id: "mine",
        name: "Mine",
        format: "tags",
        blocks: [
          { id: "appearance", type: "appearance" },
          { id: "style", type: "text", title: "Style", text: "monochrome" },
        ],
      },
    ]);
    expect(t.blocks).toEqual([
      { id: "appearance", type: "appearance" },
      { id: "style", type: "text", title: "Style", text: "monochrome" },
    ]);
  });

  it("reinserts a missing Appearance block at the top — a portrait needs a Subject", () => {
    const [t] = normalizeImageTemplates([
      { id: "mine", name: "Mine", blocks: [{ id: "style", type: "text", title: "Style", text: "x" }] },
    ]);
    expect(t.blocks[0]).toEqual({ id: APPEARANCE_BLOCK_ID, type: "appearance" });
    expect(t.blocks).toHaveLength(2);
  });

  it("drops an unreadable row rather than failing the whole list", () => {
    const [t] = normalizeImageTemplates([
      { id: "mine", name: "Mine", blocks: [null, 7, { id: "style", type: "text", title: "S", text: "x" }] },
    ]);
    expect(t.blocks.filter((b) => b.type === "text")).toHaveLength(1);
  });

  it("migrates a template saved before the block editor onto the shipped block shape", () => {
    const [t] = normalizeImageTemplates([
      {
        id: "mine",
        name: "Mine",
        format: "tags",
        portraitAction: "kept action",
        portraitStyle: "kept style",
      },
    ]);
    expect(blockText(t, PORTRAIT_ACTION_BLOCK_ID)).toBe("kept action");
    expect(blockText(t, PORTRAIT_STYLE_BLOCK_ID)).toBe("kept style");
    // Untouched clauses keep the shipped wording for that dialect.
    expect(t.blocks.find((b) => b.id === "context")).toEqual(
      TEMPLATE_TEXT.tags.blocks.find((b) => b.id === "context"),
    );
    expect(t.blocks[0]).toEqual({ id: APPEARANCE_BLOCK_ID, type: "appearance" });
  });

  it("falls an unknown format back to prose rather than storing it", () => {
    const [t] = normalizeImageTemplates([{ id: "m", name: "M", format: "haiku" }]);
    expect(t.format).toBe("prose");
    expect(blockText(t, PORTRAIT_STYLE_BLOCK_ID)).toBe(DEFAULT_PORTRAIT_STYLE);
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

  it("keeps a BLANK fixed field blank — blanking is how a rule is removed", () => {
    const [t] = normalizeImageTemplates([{ id: "m", name: "M", appearanceInstructions: "" }]);
    expect(t.appearanceInstructions).toBe("");
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
    expect(blockText(prose, PORTRAIT_STYLE_BLOCK_ID)).toBe("My own ink style.");
    expect(prose.appearanceInstructions).toBe("Three vivid clauses.");
    expect(prose.negativePrompt).toBe("blurry");
    // Untouched fields keep the shipped wording…
    expect(blockText(prose, PORTRAIT_ACTION_BLOCK_ID)).toBe(DEFAULT_PORTRAIT_ACTION);
    expect(blockText(prose, "context")).toBe(DEFAULT_PORTRAIT_CONTEXT);
    expect(blockText(prose, "composition")).toBe(DEFAULT_PORTRAIT_COMPOSITION);
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
    const list = normalizeImageTemplates(
      [{ id: "m", name: "M", blocks: [{ id: "style", type: "text", title: "S", text: "kept" }] }],
      { portraitStyle: "stale" },
    );
    expect(blockText(list[0], "style")).toBe("kept");
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
    expect(blockText(t, PORTRAIT_STYLE_BLOCK_ID)).toBe(
      blockText(builtinTemplates()[1], PORTRAIT_STYLE_BLOCK_ID),
    );
  });

  it("a duplicate keeps every block and takes a new template id", () => {
    const source = builtinTemplates()[0];
    (source.blocks.find((b) => b.id === PORTRAIT_STYLE_BLOCK_ID) as ImagePromptTextBlock).text =
      "edited";
    const copy = duplicateTemplate(source, "Copy");
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("Copy");
    expect(blockText(copy, PORTRAIT_STYLE_BLOCK_ID)).toBe("edited");
  });

  it("two new templates never collide", () => {
    expect(newTemplate("a", "prose").id).not.toBe(newTemplate("b", "prose").id);
  });
});
