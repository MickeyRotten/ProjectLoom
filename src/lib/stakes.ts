import type { Attribute, PartyMember, Settings, TurnOutcome, TurnRoll } from "../types";
import {
  ATTRIBUTE_LABELS,
  DEFAULT_ATTRIBUTE_RULES,
  bandForRoll,
  bandScale as bandScaleFor,
  characterAttributes,
  computeTN,
  normalizeAttributeRules,
  specialisationLabel,
} from "./attributes";
import { equippedAttributeBonus, heldSpecialisations } from "./equip";

/**
 * Stakes — the percentile check (RPG_DESIGN.md), sibling of the spotlight
 * (`spotlight.ts`) and successor to the shipped 1d6/`DiceRules` system this
 * file used to hold.
 *
 * The gate that decides whether an action is risky at all moved out of here:
 * it used to be a client-side keyword match (`RISK_KEYWORDS`) and is now
 * `intent.ts`'s classifier call — a surface match couldn't tell "I sneak a
 * glance at the note" (the word "sneak", no actual gamble) from a real
 * gamble. This module is what happens once a verdict is in hand: assembling
 * the Target Number from the acting character's build, rolling a seeded
 * percentile check against it, and banding the result into the same
 * STRONG/MIXED/COST vocabulary the narrator has always been handed.
 *
 * The roll itself is still on-device and still seeded on (turn, action text)
 * — `regenerateLastTurn` re-sends the same input on the same turn number, so
 * a random roll would let the player re-roll for a better answer. Only the
 * CLASSIFIER call is non-deterministic now; `store.ts` caches its verdict on
 * the turn's `Message` so a regenerate replays it instead of reclassifying.
 */

export { DEFAULT_ATTRIBUTE_RULES, normalizeAttributeRules, bandForRoll, computeTN };
export { bandScaleFor as bandScale };

/**
 * FNV-1a over the seed string. Short, dependency-free, and spreads
 * single-character edits across the whole word — consecutive turns differ by
 * very little text, and this is what keeps their rolls from correlating.
 */
export function seedHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Murmur3's finalizer — the avalanche step FNV-1a doesn't have, so the low
 * bits of the result depend on the whole word rather than leaking a fixed
 * relationship between near-identical seeds (see `stakes.test.ts` for the
 * regression this fixes: an un-avalanched hash correlated with the seed's own
 * digits).
 */
export function avalanche(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/**
 * The turn's percentile roll — pure in (turn, action text). One hash of the
 * seed, avalanched, then reduced to 1..100.
 */
export function percentileRoll(turn: number, action: string): number {
  const h = avalanche(seedHash(`${turn}|${action.trim().toLowerCase()}`));
  return (h % 100) + 1;
}

/** A throw with no turn behind it — a fresh seed per press, for any future preview UI. */
export function previewPercentile(seed: string): number {
  return percentileRoll(0, seed);
}

export interface StakeSignals {
  /** The action reads as an attempt that can fail. Gates everything below. */
  risky: boolean;
  /** Percentile roll, 1–100. */
  roll: number;
  /** Target Number the roll was checked against. */
  tn: number;
  /** The band `roll` fell into against `tn` — null when the action carried no risk. */
  outcome: TurnOutcome | null;
  /** What built the Target Number, for the chip. */
  breakdown: string;
  /** The rules this turn was resolved with, so the chip's scale line agrees with the roll. */
  rules: Settings["attributeRules"];
}

/**
 * Assemble this turn's Target Number from the acting character's build and
 * the classifier's verdict — pure, no roll yet. Exported mainly for tests;
 * `computeStakes` is the one callers actually want.
 */
function targetNumberFor(
  actor: PartyMember | undefined,
  attribute: Attribute | null,
  specialisationId: string | null,
  catalog: Settings["specialisations"],
  rules: Settings["attributeRules"],
) {
  const attrs = actor ? characterAttributes(actor) : { might: 0, agility: 0, mind: 0, presence: 0 };
  const attributeScore = attribute ? attrs[attribute] : 0;
  const gearBonus = actor && attribute ? equippedAttributeBonus(actor.blocks, attribute) : 0;
  const held = actor ? heldSpecialisations(actor) : [];
  const matched = !!specialisationId && held.includes(specialisationId);
  return computeTN({
    rules,
    attribute,
    attributeScore,
    attributeLabel: attribute ? ATTRIBUTE_LABELS[attribute] : undefined,
    gearBonus,
    specialisationMatched: matched,
    specialisationLabel: matched ? specialisationLabel(catalog, specialisationId) : undefined,
  });
}

/** Signed amount, e.g. `+10` / `−10`, for the breakdown line. */
function signedPct(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** The frozen "Might +2, Hammers specialisation, gear +1" line — "" for a bare base chance. */
export function formatBreakdown(parts: { label: string; amount: number }[]): string {
  return parts.map((p) => `${p.label} ${signedPct(p.amount)}`).join(", ");
}

/**
 * Resolve this turn's stakes for the acting character (the PC) from the
 * classifier's verdict (`intent.ts → classifyIntent`). `risky`/`attribute`/
 * `specialisation` come from the verdict, already cached or freshly
 * classified by the caller — this function does no network I/O.
 */
export function computeStakes(
  turn: number,
  action: string,
  actor: PartyMember | undefined,
  verdict: { risky: boolean; attribute: Attribute | null; specialisation: string | null },
  catalog: Settings["specialisations"],
  rules: Settings["attributeRules"] = DEFAULT_ATTRIBUTE_RULES,
): StakeSignals {
  const normalized = normalizeAttributeRules(rules);
  if (!verdict.risky) {
    return { risky: false, roll: 0, tn: 0, outcome: null, breakdown: "", rules: normalized };
  }
  const { tn, parts } = targetNumberFor(
    actor,
    verdict.attribute,
    verdict.specialisation,
    catalog,
    normalized,
  );
  const roll = percentileRoll(turn, action);
  const outcome = bandForRoll(roll, tn, normalized);
  return { risky: true, roll, tn, outcome, breakdown: formatBreakdown(parts), rules: normalized };
}

/** The roll as it is kept on the narrator message. Null when nothing was rolled. */
export function rollRecord(s: StakeSignals): TurnRoll | null {
  if (!s.outcome) return null;
  return { roll: s.roll, tn: s.tn, breakdown: s.breakdown };
}

/**
 * How a band reads to the player. Here rather than in a component because two
 * things could show it — the beat's chip today, anything else later — and a
 * band called one thing in one place and another elsewhere reads as two
 * different results.
 */
export const OUTCOME_LABEL: Record<TurnOutcome, string> = {
  strong: "Great result",
  mixed: "Mixed result",
  cost: "It cost you",
};

/**
 * The roll as one short line: `62 vs 40% · fail`, with the breakdown folded in
 * when there was one: `Might +2, gear +1 · 62 vs 40% · fail`.
 */
export function formatRoll(r: TurnRoll): string {
  const base = `${r.roll} vs ${r.tn}%`;
  return r.breakdown ? `${r.breakdown} · ${base}` : base;
}

/**
 * The `OUTCOME — THIS TURN` block: the roll, the band, and the editable rule.
 * Empty string when the action carried no risk.
 *
 * Marked authoritative for the same reason the party roll call is: the model
 * will happily narrate a triumph over a "cost" if the block reads as advice.
 */
export function formatStakesBlock(signals: StakeSignals, rule: string): string {
  if (!signals.outcome) return "";
  const breakdown = signals.breakdown ? ` (${signals.breakdown})` : "";
  return [
    "OUTCOME — THIS TURN (authoritative: narrate THIS result; never soften it, upgrade it, or talk the player out of it)",
    `The action is a gamble. Rolled ${signals.roll} against a ${signals.tn}% chance${breakdown} → ${signals.outcome.toUpperCase()}.`,
    `Scale: ${bandScaleFor(signals.tn, signals.rules)}.`,
    "",
    `RULE: ${rule.trim()}`,
  ].join("\n");
}

/**
 * The `CONDITIONS` block — who is currently carrying a mark the story left on
 * them. Separate from the outcome block because a condition outlives the turn
 * that caused it: it is state the narrator must keep reading, not a result.
 */
export function formatConditionsBlock(members: PartyMember[]): string {
  const marked = members.filter((m) => m.condition?.trim());
  if (!marked.length) return "";
  const lines = marked.map((m) => `- ${m.name}: ${m.condition.trim()}`);
  return [
    "CONDITIONS — marks this adventure has left on people (still true until the story clears them)",
    ...lines,
    'Clear one by emitting { "name": "…", "condition": "" } in "conditions" when it heals or is resolved.',
  ].join("\n");
}
