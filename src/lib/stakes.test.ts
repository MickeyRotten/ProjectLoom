import { describe, it, expect } from "vitest";
import {
  avalanche,
  computeStakes,
  formatConditionsBlock,
  formatRoll,
  formatStakesBlock,
  percentileRoll,
  rollRecord,
  seedHash,
} from "./stakes";
import { DEFAULT_ATTRIBUTE_RULES, defaultAttributes, defaultSpecialisations } from "./attributes";
import { fixedFieldBlocks } from "./testFixtures";
import type { Attributes, PartyMember, Specialisation } from "../types";

const catalog: Specialisation[] = defaultSpecialisations();

function pc(
  patch: Partial<Omit<PartyMember, "attributes">> & { attributes?: Partial<Attributes> } = {},
): PartyMember {
  const { attributes, ...rest } = patch;
  return {
    id: "pc",
    role: "pc",
    name: "Hiro",
    species: "human",
    sex: "",
    blocks: fixedFieldBlocks(),
    attributes: { ...defaultAttributes(), ...(attributes ?? {}) },
    specialisations: [],
    lastSpokeTurn: 0,
    standing: "none",
    condition: "",
    ...rest,
  };
}

describe("percentileRoll", () => {
  it("stays in 1..100", () => {
    for (let t = 1; t < 300; t++) {
      const r = percentileRoll(t, "I attack the bandit");
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(100);
    }
  });

  it("is stable for the same turn and action — a regenerate cannot re-roll", () => {
    expect(percentileRoll(7, "I attack the bandit")).toBe(percentileRoll(7, "I attack the bandit"));
    expect(percentileRoll(7, "  I Attack The Bandit  ")).toBe(percentileRoll(7, "I attack the bandit"));
  });

  it("differs across turns and across actions", () => {
    const acrossTurns = new Set(Array.from({ length: 30 }, (_, i) => percentileRoll(i + 1, "I climb the wall")));
    expect(acrossTurns.size).toBeGreaterThan(1);
    expect(percentileRoll(3, "I climb the wall")).not.toBe(percentileRoll(3, "I climb the tower"));
  });

  it("covers the full range roughly evenly — no starved values", () => {
    const counts = new Array(101).fill(0);
    for (let t = 0; t < 5000; t++) counts[percentileRoll(t, `act ${t}`)]++;
    // Every value 1..100 should show up at least once over 5000 draws.
    for (let v = 1; v <= 100; v++) expect(counts[v]).toBeGreaterThan(0);
  });
});

describe("avalanche", () => {
  it("is a pure function that mixes low bits", () => {
    expect(avalanche(seedHash("a"))).toBe(avalanche(seedHash("a")));
    expect(avalanche(seedHash("a"))).not.toBe(avalanche(seedHash("b")));
  });
});

describe("computeStakes", () => {
  const neutral = { risky: false, attribute: null, specialisation: null };

  it("rolls nothing when the verdict says not risky", () => {
    const s = computeStakes(4, "I look around.", pc(), neutral, catalog);
    expect(s.risky).toBe(false);
    expect(s.outcome).toBeNull();
    expect(s.breakdown).toBe("");
  });

  it("builds a TN from the acting character's Attribute score", () => {
    const verdict = { risky: true, attribute: "might" as const, specialisation: null };
    const s = computeStakes(4, "I smash the door open", pc({ attributes: { might: 2 } }), verdict, catalog);
    expect(s.risky).toBe(true);
    // 20 base + 2*10 = 40
    expect(s.tn).toBe(40);
    expect(s.breakdown).toContain("Might +20");
    expect(s.outcome).not.toBeNull();
  });

  it("adds the specialisation bonus only when the actor actually holds it", () => {
    const verdict = { risky: true, attribute: "might" as const, specialisation: "athletics" };
    const withSpec = computeStakes(
      4,
      "I vault the wall",
      pc({ attributes: { might: 1 }, specialisations: ["athletics"] }),
      verdict,
      catalog,
    );
    const withoutSpec = computeStakes(
      4,
      "I vault the wall",
      pc({ attributes: { might: 1 }, specialisations: [] }),
      verdict,
      catalog,
    );
    // 20 + 10 (might) + 10 (specialisation) = 40 vs 30.
    expect(withSpec.tn).toBe(40);
    expect(withoutSpec.tn).toBe(30);
    expect(withSpec.breakdown).toContain("Athletics specialisation");
  });

  it("clamps the TN inside minChance..maxChance", () => {
    const verdict = { risky: true, attribute: "might" as const, specialisation: null };
    const low = computeStakes(1, "act", pc({ attributes: { might: -1 } }), verdict, catalog, {
      ...DEFAULT_ATTRIBUTE_RULES,
      baseChance: 0,
    });
    expect(low.tn).toBe(DEFAULT_ATTRIBUTE_RULES.minChance);
  });

  it("survives a missing actor", () => {
    const verdict = { risky: true, attribute: "might" as const, specialisation: null };
    const s = computeStakes(2, "I attack the bandit", undefined, verdict, catalog);
    expect(s.risky).toBe(true);
    expect(s.tn).toBe(DEFAULT_ATTRIBUTE_RULES.baseChance);
  });

  it("is a pure function of (turn, action) for the roll itself", () => {
    const verdict = { risky: true, attribute: "might" as const, specialisation: null };
    const a = computeStakes(9, "I climb the wall", pc(), verdict, catalog);
    const b = computeStakes(9, "I climb the wall", pc(), verdict, catalog);
    expect(a.roll).toBe(b.roll);
  });
});

describe("formatStakesBlock", () => {
  it("is empty when nothing was rolled — no block, no tokens", () => {
    const s = computeStakes(1, "I look around.", pc(), { risky: false, attribute: null, specialisation: null }, catalog);
    expect(formatStakesBlock(s, "RULE TEXT")).toBe("");
  });

  it("states the roll, the band, and the rule", () => {
    const verdict = { risky: true, attribute: "might" as const, specialisation: null };
    const s = computeStakes(6, "I attack the bandit", pc({ attributes: { might: 2 } }), verdict, catalog);
    const block = formatStakesBlock(s, "  RULE TEXT  ");
    expect(block).toContain("OUTCOME — THIS TURN");
    expect(block).toContain("authoritative");
    expect(block).toContain(`Rolled ${s.roll} against a ${s.tn}% chance`);
    expect(block).toContain("Scale:");
    expect(block).toContain("RULE: RULE TEXT");
  });
});

describe("formatConditionsBlock", () => {
  it("is empty when nobody is marked", () => {
    expect(formatConditionsBlock([pc(), pc({ id: "m-navi", name: "Navi" })])).toBe("");
  });

  it("lists only the marked, and says how to clear one", () => {
    const block = formatConditionsBlock([
      pc({ condition: "Left arm in a sling" }),
      pc({ id: "m-navi", name: "Navi", condition: "   " }),
      pc({ id: "m-kai", name: "Kai", condition: "Hunted by the Watch" }),
    ]);
    expect(block).toContain("- Hiro: Left arm in a sling");
    expect(block).toContain("- Kai: Hunted by the Watch");
    expect(block).not.toContain("Navi");
    expect(block).toContain('"condition": ""');
  });
});

describe("rollRecord", () => {
  it("is null when nothing was rolled", () => {
    const s = computeStakes(1, "I look around the room", pc(), { risky: false, attribute: null, specialisation: null }, catalog);
    expect(rollRecord(s)).toBeNull();
  });

  it("carries the roll, TN, and the frozen breakdown", () => {
    const verdict = { risky: true, attribute: "might" as const, specialisation: null };
    const s = computeStakes(6, "I attack the bandit", pc({ attributes: { might: 2 } }), verdict, catalog);
    const rec = rollRecord(s);
    expect(rec).toEqual({ roll: s.roll, tn: s.tn, breakdown: s.breakdown });
  });
});

describe("formatRoll", () => {
  it("shows the breakdown when there is one", () => {
    expect(formatRoll({ roll: 62, tn: 40, breakdown: "Might +20" })).toBe("Might +20 · 62 vs 40%");
  });

  it("stays a bare roll when nothing built the TN", () => {
    expect(formatRoll({ roll: 10, tn: 20, breakdown: "" })).toBe("10 vs 20%");
  });
});
