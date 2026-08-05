import { describe, it, expect } from "vitest";
import {
  DEFAULT_DICE,
  DEFAULT_STAKE_RULES,
  MAX_DICE_COUNT,
  bandFor,
  bandScale,
  computeStakes,
  diceNotation,
  diceRange,
  formatConditionsBlock,
  formatRoll,
  formatStakesBlock,
  isRisky,
  modifierNote,
  normalizeDice,
  parseKeywords,
  previewRoll,
  rollDice,
  rollFor,
  rollRecord,
  stakeRules,
} from "./stakes";
import type { StakeRules } from "./stakes";
import { defaultSettings } from "./defaults";
import type { DiceRules, PartyMember } from "../types";

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
    expect(block).toContain("Rolled 1d6 6 +0 (nothing in play) = 6 → STRONG.");
    expect(block).toContain("Scale: 5+ strong · 3–4 mixed · 2− cost.");
    expect(block).toContain("RULE: RULE TEXT");
  });

  it("names why the modifier applied", () => {
    const action = "I smash the gate";
    const turn = turnWithRoll(action, 2);
    const block = formatStakesBlock(
      computeStakes(action, pc({ flaws: "Weak — cannot smash anything" }), turn),
      "R",
    );
    expect(block).toContain("Rolled 1d6 2 -1 (flaws in play) = 1 → COST.");
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
    // The dice are recorded alongside the arithmetic — a transcript read under a
    // system the player has since re-tuned must still show what it was rolled on.
    expect(rec).toEqual({ roll: 6, modifier: 0, total: 6, count: 1, sides: 6 });
  });

  it("flags the modifier's reason, and only when it applied", () => {
    const action = "I smash the gate";
    const turn = turnWithRoll(action, 3);
    const rec = rollRecord(
      computeStakes(action, pc({ flaws: "Weak — cannot smash anything" }), turn),
    );
    expect(rec).toEqual({ roll: 3, modifier: -1, total: 2, count: 1, sides: 6, flaws: true });
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

/* ------------------------------------------------------------------ *
 * The configurable system (Menu → RPG System). Everything above pins the
 * SHIPPED 1d6 behaviour, which every one of these must leave untouched.
 * ------------------------------------------------------------------ */

/** A rule set built off the shipped one — only what a test actually changes. */
function rules(patch: Partial<StakeRules> = {}): StakeRules {
  return { ...DEFAULT_STAKE_RULES, ...patch };
}

describe("normalizeDice", () => {
  it("passes a sane system through untouched", () => {
    const good: DiceRules = {
      diceCount: 2,
      diceSides: 6,
      strengthsBonus: 2,
      flawsPenalty: 2,
      strongThreshold: 10,
      mixedThreshold: 7,
    };
    expect(normalizeDice(good)).toEqual(good);
  });

  it("fills in anything missing from the shipped system", () => {
    expect(normalizeDice(undefined)).toEqual(DEFAULT_DICE);
    expect(normalizeDice({ diceSides: 20 }).diceCount).toBe(1);
  });

  it("clamps dice into a rollable range", () => {
    expect(normalizeDice({ diceCount: 0 }).diceCount).toBe(1);
    expect(normalizeDice({ diceCount: 999 }).diceCount).toBe(MAX_DICE_COUNT);
    // A one-sided die has no roll to make.
    expect(normalizeDice({ diceSides: 1 }).diceSides).toBe(2);
    expect(normalizeDice({ diceSides: 2.6 }).diceSides).toBe(3);
  });

  it("survives values a corrupt save could hold", () => {
    expect(normalizeDice({ diceSides: NaN }).diceSides).toBe(6);
    expect(normalizeDice({ strengthsBonus: -3 }).strengthsBonus).toBe(0);
  });

  it("keeps thresholds reachable — an impossible STRONG is a typo, not a rule", () => {
    // 1d6 with +1 tops out at 7.
    expect(normalizeDice({ strongThreshold: 50 }).strongThreshold).toBe(7);
    expect(normalizeDice({ diceCount: 2, diceSides: 6, strongThreshold: 50 }).strongThreshold).toBe(
      13,
    );
  });

  it("never lets MIXED sit above STRONG, which would leave a gap", () => {
    const r = normalizeDice({ strongThreshold: 4, mixedThreshold: 6 });
    expect(r.mixedThreshold).toBe(4);
  });
});

describe("rollDice", () => {
  it("rolls the configured number of dice, each in range", () => {
    for (let t = 1; t < 60; t++) {
      const dice = rollDice(t, "I attack the bandit", { ...DEFAULT_DICE, diceCount: 3, diceSides: 8 });
      expect(dice).toHaveLength(3);
      for (const d of dice) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(8);
      }
    }
  });

  it("keeps the first die on the original seed, so old rolls replay", () => {
    // The pre-RPG-System roll WAS this die; a save re-read under 2d6 must still
    // show the same first number it was written with.
    const one = rollFor(9, "I climb the wall");
    expect(rollDice(9, "I climb the wall", { ...DEFAULT_DICE, diceCount: 4 })[0]).toBe(one);
  });

  it("gives each extra die its own value — 2d6 is not one die doubled", () => {
    const spreads = new Set<string>();
    for (let t = 1; t < 40; t++) {
      const [a, b] = rollDice(t, "I attack", { ...DEFAULT_DICE, diceCount: 2 });
      spreads.add(`${a === b}`);
    }
    expect(spreads.has("false")).toBe(true);
  });

  it("stays stable for the same turn and action", () => {
    const r = { ...DEFAULT_DICE, diceCount: 2, diceSides: 10 };
    expect(rollDice(4, "I shoot the lock", r)).toEqual(rollDice(4, "I shoot the lock", r));
  });
});

describe("bandFor with a table's own thresholds", () => {
  it("reads the configured bands", () => {
    const r: DiceRules = { ...DEFAULT_DICE, diceSides: 20, strongThreshold: 15, mixedThreshold: 8 };
    expect(bandFor(15, r)).toBe("strong");
    expect(bandFor(14, r)).toBe("mixed");
    expect(bandFor(8, r)).toBe("mixed");
    expect(bandFor(7, r)).toBe("cost");
  });

  it("collapses to pass/fail when the two thresholds meet", () => {
    const r: DiceRules = { ...DEFAULT_DICE, strongThreshold: 4, mixedThreshold: 4 };
    expect(bandFor(4, r)).toBe("strong");
    expect(bandFor(3, r)).toBe("cost");
  });
});

describe("computeStakes under custom rules", () => {
  it("uses the table's dice and its modifiers", () => {
    const r = rules({ diceCount: 2, diceSides: 6, strengthsBonus: 3 });
    const s = computeStakes("I smash the door open", pc({ strengths: "Can smash walls" }), 5, r);
    expect(s.dice).toHaveLength(2);
    expect(s.roll).toBe(s.dice[0] + s.dice[1]);
    expect(s.modifier).toBe(3);
    expect(s.total).toBe(s.roll + 3);
    expect(s.rules.diceSides).toBe(6);
  });

  it("applies both modifiers when the action touches both, however they weigh", () => {
    const r = rules({ strengthsBonus: 3, flawsPenalty: 1 });
    const s = computeStakes(
      "I climb the tower",
      pc({ strengths: "Can climb anything", flaws: "Terrified of any tower" }),
      2,
      r,
    );
    expect(s.modifier).toBe(2);
  });

  it("rolls on every turn when the table says so", () => {
    const s = computeStakes("I look around.", pc(), 3, rules({ alwaysRoll: true }));
    expect(s.risky).toBe(true);
    expect(s.outcome).not.toBeNull();
  });

  it("rolls nothing when the player empties the risk words", () => {
    const s = computeStakes("I attack the bandit", pc(), 3, rules({ keywords: [] }));
    expect(s.risky).toBe(false);
    expect(s.outcome).toBeNull();
  });

  it("takes the player's own risk words", () => {
    const s = computeStakes("I negotiate with the guild", pc(), 3, rules({ keywords: ["negotiate"] }));
    expect(s.risky).toBe(true);
    // …and only those: the shipped list no longer applies.
    expect(computeStakes("I attack the bandit", pc(), 3, rules({ keywords: ["negotiate"] })).risky).toBe(
      false,
    );
  });
});

describe("parseKeywords", () => {
  it("splits on commas and newlines, keeping multi-word entries whole", () => {
    expect(parseKeywords("attack, climb\n pick the lock ,, ")).toEqual([
      "attack",
      "climb",
      "pick the lock",
    ]);
  });

  it("is empty for a blank field — nothing is risky", () => {
    expect(parseKeywords("   \n , ")).toEqual([]);
  });
});

describe("stakeRules", () => {
  it("reads the shipped system out of default settings", () => {
    const r = stakeRules(defaultSettings());
    expect(r.diceCount).toBe(1);
    expect(r.diceSides).toBe(6);
    expect(r.alwaysRoll).toBe(false);
    // The default keyword FIELD must parse back to the shipped list, or the
    // shipped game and a "reset to default" game would play differently.
    expect(r.keywords).toEqual(DEFAULT_STAKE_RULES.keywords);
  });

  it("sanitizes what it finds", () => {
    const r = stakeRules({ ...defaultSettings(), diceSides: 0, strongThreshold: 999 });
    expect(r.diceSides).toBe(2);
    expect(r.strongThreshold).toBeLessThanOrEqual(r.diceCount * r.diceSides + r.strengthsBonus);
  });
});

describe("diceNotation / diceRange / bandScale", () => {
  it("writes the dice the way a table does", () => {
    expect(diceNotation(DEFAULT_DICE)).toBe("1d6");
    expect(diceNotation({ ...DEFAULT_DICE, diceCount: 2, diceSides: 10 })).toBe("2d10");
  });

  it("spans the totals the dice alone can make", () => {
    expect(diceRange({ ...DEFAULT_DICE, diceCount: 2, diceSides: 6 })).toEqual({ min: 2, max: 12 });
  });

  it("spells out the bands", () => {
    expect(bandScale()).toBe("5+ strong · 3–4 mixed · 2− cost");
    expect(bandScale({ ...DEFAULT_DICE, diceSides: 20, strongThreshold: 15, mixedThreshold: 8 })).toBe(
      "15+ strong · 8–14 mixed · 7− cost",
    );
    // A one-total MIXED band reads as the single number it is.
    expect(bandScale({ ...DEFAULT_DICE, strongThreshold: 5, mixedThreshold: 4 })).toBe(
      "5+ strong · 4 mixed · 3− cost",
    );
    // No middle at all: don't print an empty range.
    expect(bandScale({ ...DEFAULT_DICE, strongThreshold: 4, mixedThreshold: 4 })).toBe(
      "4+ strong · 3− cost",
    );
  });
});

describe("multi-dice records", () => {
  it("keeps the faces, the dice, and the arithmetic", () => {
    const s = computeStakes("I attack the bandit", pc(), 3, rules({ diceCount: 2, diceSides: 6 }));
    const rec = rollRecord(s)!;
    expect(rec.count).toBe(2);
    expect(rec.sides).toBe(6);
    expect(rec.dice).toEqual(s.dice);
    expect(formatRoll(rec)).toContain(`2d6 [${s.dice.join(", ")}] ${s.roll}`);
  });

  it("shows the dice and the scale in the narrator's block", () => {
    const r = rules({ diceCount: 2, diceSides: 6, strongThreshold: 10, mixedThreshold: 7 });
    const block = formatStakesBlock(computeStakes("I attack the bandit", pc(), 3, r), "RULE");
    expect(block).toContain("Rolled 2d6 [");
    expect(block).toContain("Scale: 10+ strong · 7–9 mixed · 6− cost.");
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

describe("previewRoll", () => {
  it("rolls the configured dice and bands them the same way a turn does", () => {
    const r = rules({ diceCount: 2, diceSides: 6, strongThreshold: 10, mixedThreshold: 7 });
    const s = previewRoll(r, "test|abc");
    expect(s.dice).toHaveLength(2);
    expect(s.dice.every((d) => d >= 1 && d <= 6)).toBe(true);
    expect(s.roll).toBe(s.dice.reduce((a, b) => a + b, 0));
    expect(s.outcome).toBe(bandFor(s.total, r));
  });

  it("has no actor, so nothing modifies it", () => {
    // A Test Roll shows the SYSTEM. Strengths and Flaws belong to a character
    // taking an action, and there is neither here.
    const s = previewRoll(DEFAULT_DICE, "test|xyz");
    expect(s.modifier).toBe(0);
    expect(s.total).toBe(s.roll);
    expect(s.strengthsInPlay).toBe(false);
    expect(s.flawsInPlay).toBe(false);
    expect(rollRecord(s)).not.toBeNull();
  });

  it("always produces a result to show", () => {
    // Unlike a turn, a press of the button is never "not risky" — it must always
    // throw something, or the button looks broken.
    for (const seed of ["a", "b", "c", "d"]) {
      expect(previewRoll(DEFAULT_DICE, seed).outcome).not.toBeNull();
    }
  });

  it("gives a different seed a different chance, and the same seed the same one", () => {
    const r = rules({ diceCount: 3, diceSides: 20 });
    expect(previewRoll(r, "same")).toEqual(previewRoll(r, "same"));
    const rolls = new Set(
      Array.from({ length: 20 }, (_, i) => previewRoll(r, `seed|${i}`).total),
    );
    expect(rolls.size).toBeGreaterThan(1);
  });

  it("sanitizes broken rules rather than rolling nothing", () => {
    const s = previewRoll({ ...DEFAULT_DICE, diceCount: 0, diceSides: 1 }, "test");
    expect(s.dice.length).toBeGreaterThanOrEqual(1);
    expect(s.rules).toEqual(normalizeDice({ ...DEFAULT_DICE, diceCount: 0, diceSides: 1 }));
  });
});

describe("fair dice", () => {
  const twoD6: DiceRules = { ...DEFAULT_DICE, diceCount: 2 };

  /** Face counts for die N over many turns of one seed family. */
  function faceCounts(die: number, seed: (turn: number) => string, rules = DEFAULT_DICE) {
    const counts = new Array(rules.diceSides).fill(0);
    for (let turn = 0; turn < 3000; turn++) counts[rollDice(turn, seed(turn), rules)[die] - 1]++;
    return counts;
  }

  it("rolls every face, whatever the seed looks like", () => {
    // Regression: the raw FNV-1a hash went straight to `% diceSides`, and FNV's
    // low bit is only the XOR of the input bytes' low bits — so the die's parity
    // was a function of the seed's characters. On a seed family where the turn's
    // digits also appear in the action text the parities cancelled and a d6
    // could roll nothing but 1, 3, 5.
    for (const seed of [
      () => "I attack the bandit", // one action, many turns — ordinary play
      (t: number) => `I attack ${t}`, // the turn number inside the action too
      (t: number) => (t % 2 ? "go" : "wait"), // very short actions
    ]) {
      const counts = faceCounts(0, seed);
      expect(counts.every((n) => n > 0)).toBe(true);
      // Nothing like uniformity-testing rigour — just "no face is starved".
      expect(Math.min(...counts)).toBeGreaterThan(3000 / 6 / 2);
    }
  });

  it("can roll every sum on 2d6, 7 included", () => {
    // Regression: dice 2..n hashed `turn|action|i`, a suffix away from die one's
    // seed. FNV leaks a fixed relationship between seeds like that, which locked
    // the two dice into opposite parities — every sum came out even.
    const sums = new Set<number>();
    for (let turn = 0; turn < 400; turn++) sums.add(rollFor(turn, `I attack ${turn}`, twoD6));
    for (let sum = 2; sum <= 12; sum++) expect(sums.has(sum)).toBe(true);
  });

  it("peaks in the middle like real dice", () => {
    // The triangular distribution is the whole reason to offer 2d6 over 1d12 —
    // if the dice march in step it is neither shape.
    const counts = new Array(13).fill(0);
    for (let turn = 0; turn < 6000; turn++) counts[rollFor(turn, `act ${turn}`, twoD6)]++;
    expect(counts[7]).toBeGreaterThan(counts[2] * 3);
    expect(counts[7]).toBeGreaterThan(counts[12] * 3);
  });

  it("gives each die of a roll its own answer", () => {
    const same = Array.from({ length: 200 }, (_, t) => {
      const [a, b] = rollDice(t, "I climb the wall", twoD6);
      return a === b;
    }).filter(Boolean).length;
    // ~1 in 6 should match by chance; locked dice would be 0 or 200.
    expect(same).toBeGreaterThan(5);
    expect(same).toBeLessThan(80);
  });

  it("is still a pure function of (turn, action, rules)", () => {
    // The seeding contract itself is unchanged: a regenerate re-tells the same
    // result rather than fishing for a better one.
    expect(rollDice(4, "I lie to the guard", twoD6)).toEqual(
      rollDice(4, "  I LIE TO THE GUARD  ", twoD6),
    );
    expect(rollDice(4, "I lie to the guard", twoD6)).not.toEqual(
      rollDice(5, "I lie to the guard", twoD6),
    );
  });
});

describe("formatStakesBlock — the dice alone", () => {
  const signals = computeStakes("I climb the rotten stair", undefined, 3, {
    ...DEFAULT_STAKE_RULES,
    alwaysRoll: true,
  });

  it("carries the roll, the band and the rule, and nothing prepared for the place", () => {
    const block = formatStakesBlock(signals, "RULE TEXT");
    expect(block).toContain("authoritative");
    expect(block).toContain("RULE: RULE TEXT");
    expect(block).not.toContain("Prepared for this scene");
  });

  it("adds nothing on a turn that rolled nothing", () => {
    const quiet = computeStakes("I look around", undefined, 3, DEFAULT_STAKE_RULES);
    expect(formatStakesBlock(quiet, "RULE")).toBe("");
  });
});
