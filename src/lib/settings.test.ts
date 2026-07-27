import { describe, expect, it } from "vitest";
import type { ReasoningLevel, Settings } from "../types";
import { DEFAULT_QUICK_ACTIONS, QUICK_ACTION_COUNT, defaultSettings } from "./defaults";
import {
  FONT_LABELS,
  clampMaxTokens,
  fontTheme,
  normalizeQuickActions,
  reasoningBody,
  reasoningParam,
  usableQuickActions,
} from "./settings";
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
