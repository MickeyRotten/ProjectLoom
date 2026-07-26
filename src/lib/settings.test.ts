import { describe, expect, it } from "vitest";
import type { ReasoningLevel, Settings } from "../types";
import { defaultSettings } from "./defaults";
import { clampMaxTokens, reasoningBody, reasoningParam } from "./settings";

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
