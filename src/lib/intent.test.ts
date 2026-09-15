import { describe, it, expect } from "vitest";
import {
  NEUTRAL_VERDICT,
  buildIntentMessages,
  classifyIntent,
  parseIntentVerdict,
  scopeSpecialisations,
} from "./intent";
import { defaultSpecialisations } from "./attributes";
import { defaultSettings } from "./defaults";

const catalog = defaultSpecialisations();
const held = scopeSpecialisations(["athletics", "lore"], catalog);

describe("scopeSpecialisations", () => {
  it("resolves held ids against the catalog, dropping unknowns", () => {
    expect(scopeSpecialisations(["athletics", "not-real"], catalog)).toEqual([
      { id: "athletics", label: "Athletics", attribute: "might" },
    ]);
  });
});

describe("buildIntentMessages", () => {
  it("carries the action, scene, and scoped specialisations — nothing else", () => {
    const msgs = buildIntentMessages("I climb the wall", "Rodstroke — Market Square", held);
    const text = msgs.map((m) => m.content).join("\n");
    expect(text).toContain("I climb the wall");
    expect(text).toContain("Rodstroke — Market Square");
    expect(text).toContain("athletics: Athletics (might)");
    expect(text).toContain("lore: Lore (mind)");
  });

  it("says '(none)' for an actor with no held specialisations", () => {
    const msgs = buildIntentMessages("I wait", "", []);
    expect(msgs.some((m) => m.content.includes("(none)"))).toBe(true);
  });
});

describe("parseIntentVerdict", () => {
  it("reads a clean risky verdict", () => {
    const raw = '{"risky": true, "attribute": "agility", "specialisation": "athletics"}';
    expect(parseIntentVerdict(raw, held)).toEqual({
      risky: true,
      attribute: "agility",
      specialisation: "athletics",
    });
  });

  it("keeps a specialisation only when it was in the scoped list handed to the call", () => {
    const raw = '{"risky": true, "attribute": "might", "specialisation": "athletics"}';
    expect(parseIntentVerdict(raw, held).specialisation).toBe("athletics");
    expect(parseIntentVerdict(raw, []).specialisation).toBeNull();
  });

  it("is neutral for anything not risky, or unparseable", () => {
    expect(parseIntentVerdict('{"risky": false}', held)).toEqual(NEUTRAL_VERDICT);
    expect(parseIntentVerdict("not json at all", held)).toEqual(NEUTRAL_VERDICT);
    expect(parseIntentVerdict("", held)).toEqual(NEUTRAL_VERDICT);
  });

  it("drops an attribute outside the closed four-value list", () => {
    const raw = '{"risky": true, "attribute": "luck", "specialisation": null}';
    expect(parseIntentVerdict(raw, held).attribute).toBeNull();
  });

  it("tolerates code fences and surrounding prose", () => {
    const raw = 'Sure!\n```json\n{"risky": true, "attribute": "mind", "specialisation": null}\n```';
    expect(parseIntentVerdict(raw, held)).toEqual({ risky: true, attribute: "mind", specialisation: null });
  });
});

describe("classifyIntent — fail-open", () => {
  it("resolves to the neutral verdict when no key is configured, never throws", async () => {
    const verdict = await classifyIntent({
      settings: defaultSettings(),
      action: "I attack the bandit",
      sceneContext: "",
      heldSpecialisationIds: [],
    });
    expect(verdict).toEqual(NEUTRAL_VERDICT);
  });

  it("is neutral for a blank action without even trying the network", async () => {
    const verdict = await classifyIntent({
      settings: defaultSettings(),
      action: "   ",
      sceneContext: "",
      heldSpecialisationIds: [],
    });
    expect(verdict).toEqual(NEUTRAL_VERDICT);
  });
});
