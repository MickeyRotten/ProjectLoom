import { describe, it, expect } from "vitest";
import {
  bandFor,
  computeStakes,
  formatConditionsBlock,
  formatRoll,
  formatStakesBlock,
  isRisky,
  modifierNote,
  rollFor,
  rollRecord,
} from "./stakes";
import type { PartyMember } from "../types";

function pc(patch: Partial<PartyMember> = {}): PartyMember {
  return {
    id: "pc",
    role: "pc",
    name: "Hiro",
    species: "human",
    sex: "",
    description: "",
    personality: "",
    drive: "",
    strengths: "",
    flaws: "",
    notes: "",
    equipment: [],
    lastSpokeTurn: 0,
    standing: "none",
    condition: "",
    ...patch,
  };
}

/** Search turns for one whose roll equals `want` — the seed is a pure hash, so
 *  this is how a test pins a specific band without mocking randomness. */
function turnWithRoll(action: string, want: number): number {
  for (let t = 1; t < 500; t++) if (rollFor(t, action) === want) return t;
  throw new Error(`no turn in range rolls ${want} for ${action}`);
}

describe("isRisky", () => {
  it("catches attempts that can fail", () => {
    expect(isRisky("I attack the bandit")).toBe(true);
    expect(isRisky("I climb the wall")).toBe(true);
    expect(isRisky("I haggle with the merchant")).toBe(true);
    expect(isRisky("I lie about the map")).toBe(true);
  });

  it("leaves ordinary turns alone — the quick actions must never roll", () => {
    expect(isRisky("I look around.")).toBe(false);
    expect(isRisky("I wait to see what happens.")).toBe(false);
    expect(isRisky("I investigate my immediate surroundings carefully.")).toBe(false);
    expect(isRisky("I ask her about the village")).toBe(false);
  });

  it("matches on word boundaries, not substrings", () => {
    // "break" is a risk word; "breakfast" is not an attempt at anything.
    expect(isRisky("I eat breakfast")).toBe(false);
    // "castle" must not read as "cast".
    expect(isRisky("I admire the castle")).toBe(false);
  });
});

describe("rollFor", () => {
  it("stays in 1..6", () => {
    for (let t = 1; t < 200; t++) {
      const r = rollFor(t, "I attack the bandit");
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
  });

  it("is stable for the same turn and action — a regenerate cannot re-roll", () => {
    expect(rollFor(7, "I attack the bandit")).toBe(rollFor(7, "I attack the bandit"));
    // Whitespace and case are normalized, so a trivially different string is
    // still the same attempt.
    expect(rollFor(7, "  I Attack The Bandit  ")).toBe(rollFor(7, "I attack the bandit"));
  });

  it("differs across turns and across actions", () => {
    const sameActionAcrossTurns = new Set(
      Array.from({ length: 30 }, (_, i) => rollFor(i + 1, "I climb the wall")),
    );
    expect(sameActionAcrossTurns.size).toBeGreaterThan(1);
    // Editing the action is choosing something else, and gets its own roll.
    const a = rollFor(3, "I climb the wall");
    const b = rollFor(3, "I climb the tower");
    expect(typeof a).toBe("number");
    expect(typeof b).toBe("number");
  });
});

describe("bandFor", () => {
  it("splits 5+ / 3–4 / 2−", () => {
    expect(bandFor(7)).toBe("strong");
    expect(bandFor(5)).toBe("strong");
    expect(bandFor(4)).toBe("mixed");
    expect(bandFor(3)).toBe("mixed");
    expect(bandFor(2)).toBe("cost");
    expect(bandFor(0)).toBe("cost");
  });
});

describe("computeStakes", () => {
  it("rolls nothing for an action that carries no risk", () => {
    const s = computeStakes("I look around.", pc(), 4);
    expect(s.risky).toBe(false);
    expect(s.outcome).toBeNull();
    // Strengths/flaws are only ever "in play" on a risky action.
    expect(s.strengthsInPlay).toBe(false);
    expect(s.flawsInPlay).toBe(false);
  });

  it("gives +1 when the action leans on Strengths", () => {
    const action = "I smash the door open";
    const turn = turnWithRoll(action, 4);
    const s = computeStakes(action, pc({ strengths: "Superhuman strength — can smash walls" }), turn);
    expect(s.strengthsInPlay).toBe(true);
    expect(s.modifier).toBe(1);
    expect(s.total).toBe(5);
    expect(s.outcome).toBe("strong");
  });

  it("gives −1 when the action leans on Flaws", () => {
    const action = "I sneak past the guards";
    const turn = turnWithRoll(action, 3);
    const s = computeStakes(action, pc({ flaws: "Hopeless at anything needing subtlety — cannot sneak" }), turn);
    expect(s.flawsInPlay).toBe(true);
    expect(s.modifier).toBe(-1);
    expect(s.total).toBe(2);
    expect(s.outcome).toBe("cost");
  });

  it("cancels to 0 when the action touches both", () => {
    const action = "I climb the tower";
    const turn = turnWithRoll(action, 4);
    const s = computeStakes(
      action,
      // Exact tokens on both sides — the keyword matcher does not stem, so
      // "climber" would NOT meet "climb" (same rule the spotlight plays by).
      pc({ strengths: "Sure-footed — can climb anything", flaws: "Terrified of any tower" }),
      turn,
    );
    expect(s.strengthsInPlay).toBe(true);
    expect(s.flawsInPlay).toBe(true);
    expect(s.modifier).toBe(0);
    expect(s.total).toBe(4);
  });

  it("survives a missing actor", () => {
    const s = computeStakes("I attack the bandit", undefined, 2);
    expect(s.risky).toBe(true);
    expect(s.modifier).toBe(0);
    expect(s.outcome).not.toBeNull();
  });
});

describe("formatStakesBlock", () => {
  it("is empty when nothing was rolled — no block, no tokens", () => {
    const s = computeStakes("I look around.", pc(), 1);
    expect(formatStakesBlock(s, "RULE TEXT")).toBe("");
  });

  it("states the roll, the band, and the rule", () => {
    const action = "I attack the bandit";
    const turn = turnWithRoll(action, 6);
    const block = formatStakesBlock(computeStakes(action, pc(), turn), "  RULE TEXT  ");
    expect(block).toContain("OUTCOME — THIS TURN");
    expect(block).toContain("authoritative");
    expect(block).toContain("Rolled 6 +0 (nothing in play) = 6 → STRONG.");
    expect(block).toContain("RULE: RULE TEXT");
  });

  it("names why the modifier applied", () => {
    const action = "I smash the gate";
    const turn = turnWithRoll(action, 2);
    const block = formatStakesBlock(
      computeStakes(action, pc({ flaws: "Weak — cannot smash anything" }), turn),
      "R",
    );
    expect(block).toContain("Rolled 2 -1 (flaws in play) = 1 → COST.");
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
    expect(rollRecord(computeStakes("I look around the room", pc(), 1))).toBeNull();
  });

  it("keeps the arithmetic the block showed the narrator", () => {
    const action = "I attack the bandit";
    const turn = turnWithRoll(action, 6);
    const rec = rollRecord(computeStakes(action, pc(), turn));
    expect(rec).toEqual({ roll: 6, modifier: 0, total: 6 });
  });

  it("flags the modifier's reason, and only when it applied", () => {
    const action = "I smash the gate";
    const turn = turnWithRoll(action, 3);
    const rec = rollRecord(
      computeStakes(action, pc({ flaws: "Weak — cannot smash anything" }), turn),
    );
    expect(rec).toEqual({ roll: 3, modifier: -1, total: 2, flaws: true });
    expect(modifierNote(rec!)).toBe("flaws in play");
  });
});

describe("formatRoll", () => {
  it("spells out the arithmetic when something modified it", () => {
    expect(formatRoll({ roll: 4, modifier: 1, total: 5 })).toBe("1d6 4 +1 = 5");
    expect(formatRoll({ roll: 1, modifier: -1, total: 0 })).toBe("1d6 1 -1 = 0");
  });

  it("stays a bare roll when nothing did", () => {
    expect(formatRoll({ roll: 4, modifier: 0, total: 4 })).toBe("1d6 4");
  });
});

describe("modifierNote", () => {
  it("names both when both applied", () => {
    expect(modifierNote({ strengths: true, flaws: true })).toBe(
      "strengths and flaws both in play",
    );
    expect(modifierNote({ strengths: true })).toBe("strengths in play");
    expect(modifierNote({})).toBe("nothing in play");
  });
});
