import { describe, it, expect } from "vitest";
import {
  DEFAULT_ATTRIBUTE_RULES,
  bandForRoll,
  bandScale,
  characterAttributes,
  characterSpecialisations,
  computeTN,
  defaultAttributes,
  defaultSpecialisations,
  formatBuild,
  normalizeAttributeRules,
  normalizeAttributes,
  normalizeSpecialisations,
  specialisationLabel,
} from "./attributes";

describe("normalizeAttributes", () => {
  it("defaults to all-zero", () => {
    expect(normalizeAttributes(undefined)).toEqual(defaultAttributes());
  });

  it("clamps into -1..3", () => {
    expect(normalizeAttributes({ might: 99 }).might).toBe(3);
    expect(normalizeAttributes({ might: -99 }).might).toBe(-1);
    expect(normalizeAttributes({ might: NaN }).might).toBe(0);
  });
});

describe("characterAttributes / characterSpecialisations", () => {
  it("read absent fields as blank", () => {
    expect(characterAttributes({ attributes: undefined })).toEqual(defaultAttributes());
    expect(characterSpecialisations({ specialisations: undefined })).toEqual([]);
  });
});

describe("normalizeAttributeRules", () => {
  it("passes the shipped rules through untouched", () => {
    expect(normalizeAttributeRules(DEFAULT_ATTRIBUTE_RULES)).toEqual(DEFAULT_ATTRIBUTE_RULES);
  });

  it("fills in anything missing", () => {
    expect(normalizeAttributeRules(undefined)).toEqual(DEFAULT_ATTRIBUTE_RULES);
  });

  it("reconciles a floor above the ceiling", () => {
    const r = normalizeAttributeRules({ minChance: 90, maxChance: 10 });
    expect(r.maxChance).toBeGreaterThanOrEqual(r.minChance);
  });

  it("survives values a corrupt save could hold", () => {
    expect(normalizeAttributeRules({ baseChance: NaN }).baseChance).toBe(DEFAULT_ATTRIBUTE_RULES.baseChance);
  });
});

describe("computeTN", () => {
  it("is the base chance alone when nothing applies", () => {
    const { tn, parts } = computeTN({
      rules: DEFAULT_ATTRIBUTE_RULES,
      attribute: null,
      attributeScore: 0,
      gearBonus: 0,
      specialisationMatched: false,
    });
    expect(tn).toBe(DEFAULT_ATTRIBUTE_RULES.baseChance);
    expect(parts).toEqual([]);
  });

  it("adds the attribute, gear, and specialisation pieces", () => {
    const { tn, parts } = computeTN({
      rules: DEFAULT_ATTRIBUTE_RULES,
      attribute: "might",
      attributeScore: 2,
      attributeLabel: "Might",
      gearBonus: 1,
      specialisationMatched: true,
      specialisationLabel: "Hammers",
    });
    // 20 + 20 (might) + 10 (gear) + 10 (spec) = 60
    expect(tn).toBe(60);
    expect(parts).toEqual([
      { label: "Might", amount: 20 },
      { label: "gear", amount: 10 },
      { label: "Hammers specialisation", amount: 10 },
    ]);
  });

  it("clamps to the configured floor and ceiling", () => {
    const { tn } = computeTN({
      rules: { ...DEFAULT_ATTRIBUTE_RULES, baseChance: 0 },
      attribute: "might",
      attributeScore: -1,
      gearBonus: 0,
      specialisationMatched: false,
    });
    expect(tn).toBe(DEFAULT_ATTRIBUTE_RULES.minChance);
  });
});

describe("bandForRoll — the worked examples", () => {
  it("TN 90 → Great 1-72, Mixed 73-90, Fail 91-100", () => {
    expect(bandForRoll(1, 90, DEFAULT_ATTRIBUTE_RULES)).toBe("strong");
    expect(bandForRoll(72, 90, DEFAULT_ATTRIBUTE_RULES)).toBe("strong");
    expect(bandForRoll(73, 90, DEFAULT_ATTRIBUTE_RULES)).toBe("mixed");
    expect(bandForRoll(90, 90, DEFAULT_ATTRIBUTE_RULES)).toBe("mixed");
    expect(bandForRoll(91, 90, DEFAULT_ATTRIBUTE_RULES)).toBe("cost");
    expect(bandForRoll(100, 90, DEFAULT_ATTRIBUTE_RULES)).toBe("cost");
  });

  it("TN 10 → Great 1-8, Mixed 9-10, Fail 11-100", () => {
    expect(bandForRoll(8, 10, DEFAULT_ATTRIBUTE_RULES)).toBe("strong");
    expect(bandForRoll(9, 10, DEFAULT_ATTRIBUTE_RULES)).toBe("mixed");
    expect(bandForRoll(10, 10, DEFAULT_ATTRIBUTE_RULES)).toBe("mixed");
    expect(bandForRoll(11, 10, DEFAULT_ATTRIBUTE_RULES)).toBe("cost");
  });

  it("Fail is always exactly 100 - TN", () => {
    for (const tn of [10, 25, 50, 75, 90]) {
      let fails = 0;
      for (let roll = 1; roll <= 100; roll++) {
        if (bandForRoll(roll, tn, DEFAULT_ATTRIBUTE_RULES) === "cost") fails++;
      }
      expect(fails).toBe(100 - tn);
    }
  });
});

describe("bandScale", () => {
  it("spells out the bands for the TN 90 example", () => {
    expect(bandScale(90, DEFAULT_ATTRIBUTE_RULES)).toBe("1–72 great · 73–90 mixed · 91–100 fail");
  });
});

describe("normalizeSpecialisations", () => {
  it("falls back to the shipped catalog when storage holds none", () => {
    expect(normalizeSpecialisations(undefined)).toEqual(defaultSpecialisations());
    expect(normalizeSpecialisations([])).toEqual(defaultSpecialisations());
  });

  it("de-duplicates by id and fills a missing attribute", () => {
    const out = normalizeSpecialisations([
      { id: "a", label: "Foo", attribute: "mind" },
      { id: "a", label: "Duplicate", attribute: "presence" },
      { id: "b", label: "Bar" },
    ]);
    expect(out).toEqual([
      { id: "a", label: "Foo", attribute: "mind" },
      { id: "b", label: "Bar", attribute: "might" },
    ]);
  });
});

describe("specialisationLabel / formatBuild", () => {
  const catalog = defaultSpecialisations();

  it("resolves a held id to its label, blank when gone", () => {
    expect(specialisationLabel(catalog, "athletics")).toBe("Athletics");
    expect(specialisationLabel(catalog, "not-real")).toBe("");
    expect(specialisationLabel(catalog, null)).toBe("");
  });

  it("is blank for an untouched character", () => {
    expect(formatBuild({ attributes: undefined, specialisations: undefined }, catalog)).toBe("");
  });

  it("prints scores and held specialisations", () => {
    const line = formatBuild(
      { attributes: { might: 2, agility: 0, mind: -1, presence: 0 }, specialisations: ["athletics"] },
      catalog,
    );
    expect(line).toBe("Build: Might +2, Agility +0, Mind -1, Presence +0 — Specialisations: Athletics");
  });
});
