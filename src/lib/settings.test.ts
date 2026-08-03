import { describe, expect, it } from "vitest";
import type { ReasoningLevel, Settings } from "../types";
import {
  DEFAULT_INK,
  DEFAULT_JOURNAL_MAX_TURNS,
  DEFAULT_JOURNAL_MIN_TURNS,
  DEFAULT_PAPER,
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_TEXT_SIZE,
  QUICK_ACTION_COUNT,
  defaultSettings,
} from "./defaults";
import {
  COLOR_PRESETS,
  FONT_LABELS,
  MAX_JOURNAL_BUDGET,
  MAX_JOURNAL_TURNS,
  MAX_TEXT_SIZE,
  MIN_JOURNAL_TURNS,
  MIN_TEXT_SIZE,
  clampJournalBudget,
  clampJournalMaxTurns,
  clampJournalMinTurns,
  clampMaxTokens,
  clampTextSize,
  fontTheme,
  isDarkPaper,
  loadSettings,
  normalizeHex,
  normalizeQuickActions,
  normalizeWebFonts,
  reasoningBody,
  reasoningParam,
  saveSettings,
  scrimFrom,
  usableQuickActions,
} from "./settings";
import { DEFAULT_COMFY, MAX_COMFY_STEPS, MIN_COMFY_SIDE } from "./comfyui";
import { activeTemplate, builtinTemplates, PROSE_TEMPLATE_ID } from "./imageTemplates";
import { FONT_CHOICES } from "../types";

function settingsWith(reasoningLevel: ReasoningLevel): Settings {
  return { ...defaultSettings(), reasoningLevel };
}

describe("reasoningParam", () => {
  it("omits the field on auto, so the request is unchanged", () => {
    expect(reasoningParam("auto")).toBeNull();
  });

  it("disables thinking on off", () => {
    // `enabled: false` is the disable switch — NOT `exclude`, which only hides
    // reasoning the model still does and still bills for.
    expect(reasoningParam("off")).toEqual({ enabled: false });
  });

  it("maps every effort level through, excluding the text", () => {
    for (const level of ["minimal", "low", "medium", "high"] as const) {
      expect(reasoningParam(level)).toEqual({ effort: level, exclude: true });
    }
  });

  it("omits the field for a value no build ever wrote", () => {
    // A level out of localStorage from another build must not reach the API.
    expect(reasoningParam("ultra" as ReasoningLevel)).toBeNull();
  });
});

describe("reasoningBody", () => {
  it("spreads to nothing on the shipped default", () => {
    expect(reasoningBody(defaultSettings())).toEqual({});
  });

  it("wraps the param under `reasoning` when there is one", () => {
    expect(reasoningBody(settingsWith("high"))).toEqual({
      reasoning: { effort: "high", exclude: true },
    });
    expect(reasoningBody(settingsWith("off"))).toEqual({ reasoning: { enabled: false } });
  });
});

describe("clampMaxTokens", () => {
  it("keeps 0 as 'no cap' and rounds a real cap", () => {
    expect(clampMaxTokens(0)).toBe(0);
    expect(clampMaxTokens(700.4)).toBe(700);
  });

  it("floors nonsense to 0 and ceilings a runaway", () => {
    expect(clampMaxTokens(NaN)).toBe(0);
    expect(clampMaxTokens(-5)).toBe(0);
    expect(clampMaxTokens(999_999)).toBe(8000);
  });
});

describe("fontTheme", () => {
  it("passes every shipped choice through unchanged", () => {
    for (const font of FONT_CHOICES) expect(fontTheme(font)).toBe(font);
  });

  it("falls back to the platform stack for anything else", () => {
    // A font out of localStorage from another build would otherwise leave
    // --font-mono pointing at a family no @font-face defines.
    expect(fontTheme("comic-sans")).toBe("system");
    expect(fontTheme(undefined)).toBe("system");
    expect(fontTheme("")).toBe("system");
  });

  it("accepts an added font's id", () => {
    const added = [{ family: "Silkscreen", id: "silkscreen", ranges: [] }];
    expect(fontTheme("silkscreen", added)).toBe("silkscreen");
  });

  it("drops a selection whose font has since been removed", () => {
    // Remove deletes the files and the CSS rule with them; a `data-font` still
    // pointing there would leave --font-mono on a family nothing defines.
    expect(fontTheme("silkscreen", [])).toBe("system");
  });

  it("ships the default on the shipped settings", () => {
    expect(fontTheme(defaultSettings().font)).toBe("system");
  });

  it("has picker copy for every choice", () => {
    for (const font of FONT_CHOICES) {
      expect(FONT_LABELS[font].label).toBeTruthy();
      expect(FONT_LABELS[font].note).toBeTruthy();
    }
  });
});

describe("normalizeQuickActions", () => {
  it("hands back the shipped shortcuts when nothing is stored", () => {
    // Every save written before the row was editable has no `quickActions` key.
    expect(normalizeQuickActions(undefined)).toEqual(DEFAULT_QUICK_ACTIONS);
    expect(normalizeQuickActions(null)).toEqual(DEFAULT_QUICK_ACTIONS);
    expect(normalizeQuickActions("Look")).toEqual(DEFAULT_QUICK_ACTIONS);
  });

  it("always returns exactly one row per shortcut", () => {
    // Short, long or ragged — the editor addresses rows by index.
    expect(normalizeQuickActions([]).length).toBe(QUICK_ACTION_COUNT);
    expect(normalizeQuickActions([{ label: "A", input: "a" }]).length).toBe(QUICK_ACTION_COUNT);
    expect(
      normalizeQuickActions([1, 2, 3, 4, 5].map((n) => ({ label: `${n}`, input: `${n}` }))).length,
    ).toBe(QUICK_ACTION_COUNT);
  });

  it("fills a missing row from the default and keeps the written ones", () => {
    const actions = normalizeQuickActions([{ label: "Listen", input: "I listen." }]);
    expect(actions[0]).toEqual({ label: "Listen", input: "I listen." });
    expect(actions[1]).toEqual(DEFAULT_QUICK_ACTIONS[1]);
    expect(actions[2]).toEqual(DEFAULT_QUICK_ACTIONS[2]);
  });

  it("keeps a blank row blank — that is how a button is removed", () => {
    // Falling back to the default here would make the third button undeletable.
    const actions = normalizeQuickActions([
      { label: "", input: "" },
      DEFAULT_QUICK_ACTIONS[1],
      DEFAULT_QUICK_ACTIONS[2],
    ]);
    expect(actions[0]).toEqual({ label: "", input: "" });
  });

  it("trims, and falls back per half on a non-string", () => {
    const actions = normalizeQuickActions([{ label: "  Peek  ", input: 42 }]);
    expect(actions[0]).toEqual({ label: "Peek", input: DEFAULT_QUICK_ACTIONS[0].input });
  });

  it("survives junk rows", () => {
    expect(normalizeQuickActions([null, "nope", 7])).toEqual(DEFAULT_QUICK_ACTIONS);
  });
});

describe("usableQuickActions", () => {
  it("ships three buttons by default", () => {
    expect(usableQuickActions(defaultSettings().quickActions).length).toBe(QUICK_ACTION_COUNT);
  });

  it("drops a row missing either half", () => {
    const actions = usableQuickActions([
      { label: "Look", input: "I look around." },
      { label: "Wait", input: "   " },
      { label: "", input: "I run." },
    ]);
    expect(actions.map((a) => a.label)).toEqual(["Look"]);
  });
});

describe("journal clamps", () => {
  it("keeps 0 for the budget — it means inject nothing", () => {
    expect(clampJournalBudget(0)).toBe(0);
    expect(clampJournalBudget(-50)).toBe(0);
  });

  it("caps the budget and rounds", () => {
    expect(clampJournalBudget(MAX_JOURNAL_BUDGET + 5000)).toBe(MAX_JOURNAL_BUDGET);
    expect(clampJournalBudget(612.4)).toBe(612);
  });

  it("pins the turn triggers inside the usable range", () => {
    // A stored 0 for the gap would make every single turn a boundary.
    expect(clampJournalMaxTurns(0)).toBe(MIN_JOURNAL_TURNS);
    expect(clampJournalMinTurns(0)).toBe(MIN_JOURNAL_TURNS);
    expect(clampJournalMaxTurns(9999)).toBe(MAX_JOURNAL_TURNS);
  });

  it("falls a garbage value back to the shipped default", () => {
    expect(clampJournalMaxTurns(NaN)).toBe(DEFAULT_JOURNAL_MAX_TURNS);
    expect(clampJournalMinTurns(NaN)).toBe(DEFAULT_JOURNAL_MIN_TURNS);
  });
});

describe("clampTextSize", () => {
  it("rounds and pins to the readable range", () => {
    expect(clampTextSize(17.6)).toBe(18);
    expect(clampTextSize(2)).toBe(MIN_TEXT_SIZE);
    expect(clampTextSize(400)).toBe(MAX_TEXT_SIZE);
  });

  it("falls a garbage value back to the shipped size", () => {
    expect(clampTextSize(NaN)).toBe(DEFAULT_TEXT_SIZE);
  });
});

describe("normalizeHex", () => {
  it("normalizes case and the short form", () => {
    expect(normalizeHex("#FFB000", "#000000")).toBe("#ffb000");
    expect(normalizeHex("#f0a", "#000000")).toBe("#ff00aa");
    expect(normalizeHex("  #FFF  ", "#000000")).toBe("#ffffff");
  });

  it("accepts a bare hex, since hand-typed values arrive without the hash", () => {
    expect(normalizeHex("ffb000", "#000000")).toBe("#ffb000");
  });

  it("falls back on anything it cannot render", () => {
    // A color nobody can see would hide the Appearance screen itself, which is
    // the only way back from it.
    expect(normalizeHex("rebeccapurple", "#123456")).toBe("#123456");
    expect(normalizeHex("#12345", "#123456")).toBe("#123456");
    expect(normalizeHex(null, "#123456")).toBe("#123456");
    expect(normalizeHex(42, "#123456")).toBe("#123456");
  });
});

describe("derived colors", () => {
  it("reads the paper's luminance, not its channel count", () => {
    expect(isDarkPaper("#000000")).toBe(true);
    expect(isDarkPaper("#ffffff")).toBe(false);
    // Saturated but dark — an amber-on-black terminal is a dark theme.
    expect(isDarkPaper("#0d0700")).toBe(true);
    // Bright yellow has high luminance despite a zero blue channel.
    expect(isDarkPaper("#ffff00")).toBe(false);
  });

  it("builds the scrim from the ink at 60%", () => {
    expect(scrimFrom("#000000")).toBe("rgb(0 0 0 / 0.6)");
    expect(scrimFrom("#ffb000")).toBe("rgb(255 176 0 / 0.6)");
  });

  it("ships presets that are all renderable pairs", () => {
    for (const p of COLOR_PRESETS) {
      expect(normalizeHex(p.paper, "")).toBe(p.paper);
      expect(normalizeHex(p.ink, "")).toBe(p.ink);
      // A preset whose two colors matched would be an unreadable screen.
      expect(p.paper).not.toBe(p.ink);
    }
  });

  it("keeps the old Invert toggle reachable as the first two presets", () => {
    expect(COLOR_PRESETS[0]).toMatchObject({ paper: "#ffffff", ink: "#000000" });
    expect(COLOR_PRESETS[1]).toMatchObject({ paper: "#000000", ink: "#ffffff" });
  });
});

describe("normalizeWebFonts", () => {
  it("hands back nothing when nothing is stored", () => {
    expect(normalizeWebFonts(undefined)).toEqual([]);
    expect(normalizeWebFonts("Silkscreen")).toEqual([]);
  });

  it("keeps well-formed rows and drops the rest", () => {
    const rows = normalizeWebFonts([
      { family: " Silkscreen ", id: "silkscreen", ranges: ["U+0-FF"] },
      { family: "", id: "blank" },
      { family: "No Id", id: "  " },
      null,
      { family: "Ranges Missing", id: "ranges-missing" },
    ]);
    expect(rows).toEqual([
      { family: "Silkscreen", id: "silkscreen", ranges: ["U+0-FF"] },
      { family: "Ranges Missing", id: "ranges-missing", ranges: [] },
    ]);
  });

  it("collapses a duplicate id — one row per CSS selector", () => {
    const rows = normalizeWebFonts([
      { family: "Silkscreen", id: "silkscreen", ranges: [] },
      { family: "Silkscreen", id: "silkscreen", ranges: [] },
    ]);
    expect(rows.length).toBe(1);
  });
});

describe("loadSettings migrations", () => {
  const write = (stored: Record<string, unknown>) =>
    localStorage.setItem("loom.settings", JSON.stringify(stored));

  it("ships the defaults on a fresh install", () => {
    localStorage.clear();
    const s = loadSettings();
    expect(s.paper).toBe(DEFAULT_PAPER);
    expect(s.ink).toBe(DEFAULT_INK);
    expect(s.textSize).toBe(DEFAULT_TEXT_SIZE);
    expect(s.webFonts).toEqual([]);
  });

  it("keeps a save from before ComfyUI existed on the OpenRouter backend", () => {
    write({ openRouterKey: "sk-old" });
    const s = loadSettings();
    expect(s.imageBackend).toBe("openrouter");
    expect(s.comfyUrl).toBe(DEFAULT_COMFY.comfyUrl);
    expect(s.comfyWorkflow).toBe(DEFAULT_COMFY.comfyWorkflow);
  });

  it("sanitizes stored ComfyUI numbers on read, not on write", () => {
    write({ imageBackend: "comfyui", comfySteps: 9999, comfyWidth: 3 });
    const s = loadSettings();
    expect(s.imageBackend).toBe("comfyui");
    expect(s.comfySteps).toBe(MAX_COMFY_STEPS);
    expect(s.comfyWidth).toBe(MIN_COMFY_SIDE);
  });

  it("carries the old Invert toggle onto the color pair", () => {
    write({ invert: true });
    expect(loadSettings()).toMatchObject({ paper: "#000000", ink: "#ffffff" });
    write({ invert: false });
    expect(loadSettings()).toMatchObject({ paper: "#ffffff", ink: "#000000" });
  });

  it("carries every old text scale onto the pixels it already rendered at", () => {
    for (const [scale, px] of [
      ["s", 14],
      ["m", 16],
      ["l", 18],
      ["xl", 20],
    ] as const) {
      write({ textScale: scale });
      expect(loadSettings().textSize).toBe(px);
    }
  });

  it("prefers a written pixel size over the legacy scale", () => {
    write({ textScale: "xl", textSize: 24 });
    expect(loadSettings().textSize).toBe(24);
  });

  it("sanitizes a corrupted color and size rather than rendering them", () => {
    write({ paper: "not a color", ink: "#F0A", textSize: 900 });
    const s = loadSettings();
    expect(s.paper).toBe(DEFAULT_PAPER);
    expect(s.ink).toBe("#ff00aa");
    expect(s.textSize).toBe(MAX_TEXT_SIZE);
  });

  it("carries the old flat image-prompt fields onto the prose template", () => {
    write({
      bannerInstructions: "My banner style.",
      portraitStyle: "My ink style.",
      appearanceInstructions: "Three vivid clauses.",
      comfyNegativePrompt: "blurry, lowres",
    });
    const s = loadSettings();
    expect(s.imageTemplateId).toBe(PROSE_TEMPLATE_ID);
    const prose = activeTemplate(s);
    expect(prose.bannerInstructions).toBe("My banner style.");
    expect(prose.portraitStyle).toBe("My ink style.");
    expect(prose.appearanceInstructions).toBe("Three vivid clauses.");
    expect(prose.negativePrompt).toBe("blurry, lowres");
    // The tag dialect arrives alongside, so the migration ADDS a choice rather
    // than replacing one.
    expect(s.imageTemplates.map((t) => t.format)).toEqual(["prose", "tags"]);
  });

  it("gives a save with no image settings at all both shipped templates", () => {
    write({ openRouterKey: "sk-old" });
    expect(loadSettings().imageTemplates).toEqual(builtinTemplates());
  });

  it("falls a stored selection that no longer exists back to a real template", () => {
    write({ imageTemplateId: "deleted" });
    // The id is kept as stored — it is what the player picked — but nothing
    // downstream can be handed a missing template.
    expect(activeTemplate(loadSettings()).id).toBe(PROSE_TEMPLATE_ID);
  });

  it("round-trips a saved settings object", () => {
    const written = { ...defaultSettings(), paper: "#001100", ink: "#33ff33", textSize: 22 };
    saveSettings(written);
    expect(loadSettings()).toMatchObject({ paper: "#001100", ink: "#33ff33", textSize: 22 });
    localStorage.clear();
  });
});
