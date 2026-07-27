import type { DiceRules, PartyMember, Settings, TurnOutcome, TurnRoll } from "../types";
import { extractKeywords, intersects } from "./spotlight";
import { keywordHits } from "./worldNotes";

/**
 * Stakes — deterministic, single-call, in the same shape as the spotlight
 * (`spotlight.ts`; read that first, this is its sibling).
 *
 * NO extra LLM call, and no asking the narrator how it went. Every turn we
 * decide on-device whether the player's action carries risk, roll dice that are
 * a pure function of (turn, action text), modify the total by whether the action
 * leans on the actor's Strengths or their Flaws, and hand the narrator ONE
 * outcome band it must honour. The narrator writes the prose; it does not get to
 * pick the result.
 *
 * Which dice, which modifiers, which thresholds, and what even counts as risky
 * are all `DiceRules` / `StakeRules` — Menu → RPG System. `DEFAULT_DICE` is the
 * 1d6 system this file used to hardcode, so an unconfigured game plays the same.
 *
 * Why this exists: without it every action succeeds exactly as much as the
 * model feels like. `Character.flaws` in particular had no mechanical consumer
 * anywhere — it was printed into the prompt and read by nothing.
 *
 * Why the roll is seeded rather than random: `regenerateLastTurn` re-sends the
 * same input on the same turn, so a random roll would let the player re-roll
 * until the answer was "strong". Seeding on (turn, text) means a regenerate
 * gives a different *telling* of the same result, and editing the action —
 * genuinely choosing something else — gives a different roll.
 */

/**
 * The SHIPPED list of verbs and nouns that make an action a gamble — the
 * default of `Settings.riskKeywords`, which the player owns from RPG System.
 * Word-boundary matched via the World Notes matcher, so one definition of
 * "mentioned" serves lore, cast, and risk alike.
 *
 * Deliberately about ATTEMPTS, not violence: haggling and lying are as risky as
 * swinging a sword, and "look around" is not risky at all — which is what keeps
 * the quick actions and ordinary conversation out of the dice entirely.
 */
export const RISK_KEYWORDS = [
  "attack", "attacks", "fight", "fights", "strike", "strikes", "swing",
  "swings", "stab", "stabs", "shoot", "shoots", "kill", "kills", "charge",
  "charges", "ambush", "disarm", "block", "parry", "dodge", "throw", "throws",
  "climb", "climbs", "jump", "jumps", "leap", "leaps", "swim", "swims",
  "sneak", "sneaks", "hide", "hides", "steal", "steals", "pickpocket",
  "lockpick", "pick the lock", "break", "breaks", "force", "forces", "smash",
  "pry", "chase", "chases", "flee", "flees", "run from", "escape", "escapes",
  "lie", "lies", "bluff", "bluffs", "trick", "tricks", "persuade", "persuades",
  "convince", "convinces", "threaten", "threatens", "intimidate", "seduce",
  "seduces", "haggle", "haggles", "bargain", "bargains", "barter",
  "cast", "casts", "summon", "summons", "channel", "channels", "banish",
  "sabotage", "distract", "distracts", "disable", "rescue", "rescues",
  "catch", "catches", "grab", "grabs", "wrestle", "tackle", "tackles",
  "gamble", "gambles", "bet", "bets", "race", "races", "outrun",
];

/* ------------------------------------------------------------------ *
 * The rules themselves (Menu → RPG System). Everything below reads its
 * numbers from a `DiceRules`; nothing hardcodes a d6 any more.
 * ------------------------------------------------------------------ */

/**
 * The shipped system: one d6, ±1 for Strengths/Flaws, 5+ / 3–4 / 2−. These are
 * the numbers stakes.ts carried in its own body before the dice were settings,
 * so an unconfigured game (and every call that omits its rules — tests, replayed
 * records) behaves exactly as it always did.
 */
export const DEFAULT_DICE: DiceRules = {
  diceCount: 1,
  diceSides: 6,
  strengthsBonus: 1,
  flawsPenalty: 1,
  strongThreshold: 5,
  mixedThreshold: 3,
};

/** Ceilings for the player-entered numbers — generous, but rollable. */
export const MAX_DICE_COUNT = 10;
export const MAX_DICE_SIDES = 100;
export const MAX_MODIFIER = 20;

/** Clamp one player-entered integer, falling back when it isn't a number. */
function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Sanitize a stored/edited rule set into one that can actually resolve a turn.
 *
 * Thresholds are pinned inside the range the dice can REACH, so a stray digit
 * ("strong on 50+" with 1d6) can't make a band unreachable and silently turn
 * every gamble into a disaster; and MIXED can never sit above STRONG, which
 * would leave a gap no total falls into.
 */
export function normalizeDice(rules: Partial<DiceRules> | undefined): DiceRules {
  const r = { ...DEFAULT_DICE, ...(rules ?? {}) };
  const diceCount = clampInt(r.diceCount, 1, MAX_DICE_COUNT, DEFAULT_DICE.diceCount);
  const diceSides = clampInt(r.diceSides, 2, MAX_DICE_SIDES, DEFAULT_DICE.diceSides);
  const strengthsBonus = clampInt(r.strengthsBonus, 0, MAX_MODIFIER, DEFAULT_DICE.strengthsBonus);
  const flawsPenalty = clampInt(r.flawsPenalty, 0, MAX_MODIFIER, DEFAULT_DICE.flawsPenalty);
  // The widest total a turn can produce, worst modifier to best.
  const low = diceCount - flawsPenalty;
  const high = diceCount * diceSides + strengthsBonus;
  const strongThreshold = clampInt(r.strongThreshold, low, high, DEFAULT_DICE.strongThreshold);
  const mixedThreshold = clampInt(r.mixedThreshold, low, strongThreshold, DEFAULT_DICE.mixedThreshold);
  return {
    diceCount,
    diceSides,
    strengthsBonus,
    flawsPenalty,
    strongThreshold,
    mixedThreshold,
  };
}

/** `2d6` — the dice as a table would write them. */
export function diceNotation(rules: DiceRules): string {
  const { diceCount, diceSides } = normalizeDice(rules);
  return `${diceCount}d${diceSides}`;
}

/** Lowest and highest the dice alone can come to (before modifiers). */
export function diceRange(rules: DiceRules): { min: number; max: number } {
  const { diceCount, diceSides } = normalizeDice(rules);
  return { min: diceCount, max: diceCount * diceSides };
}

/**
 * The full rule set a turn is resolved with: the dice, what counts as a gamble,
 * and whether anything counts at all.
 */
export interface StakeRules extends DiceRules {
  /** Words that make an action risky. Empty means nothing matches. */
  keywords: string[];
  /** Roll on every turn regardless of `keywords`. */
  alwaysRoll: boolean;
}

export const DEFAULT_STAKE_RULES: StakeRules = {
  ...DEFAULT_DICE,
  keywords: RISK_KEYWORDS,
  alwaysRoll: false,
};

/**
 * Split the player's risk-word list. Commas and newlines both separate, so a
 * pasted list works however it was written; multi-word entries ("pick the
 * lock") survive because nothing splits on spaces.
 */
export function parseKeywords(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

/** The rules as Settings holds them — the one place the two shapes meet. */
export function stakeRules(settings: Settings): StakeRules {
  return {
    ...normalizeDice(settings),
    keywords: parseKeywords(settings.riskKeywords),
    alwaysRoll: settings.alwaysRoll,
  };
}

export interface StakeSignals {
  /** The action reads as an attempt that can fail. Gates everything below. */
  risky: boolean;
  /** The action leans on the acting character's Strengths. */
  strengthsInPlay: boolean;
  /** The action leans on the acting character's Flaws. */
  flawsInPlay: boolean;
  /** Each die as it landed — `[4, 3]` for 2d6. */
  dice: number[];
  /** The dice total, before the modifier. */
  roll: number;
  /** Strengths/Flaws modifier applied to the roll. */
  modifier: number;
  /** `roll + modifier`. */
  total: number;
  /** The band `total` fell into — null when the action carried no risk. */
  outcome: TurnOutcome | null;
  /** The dice this turn was resolved with, so every reader agrees on them. */
  rules: DiceRules;
}

/**
 * FNV-1a over the seed string. Any stable hash would do; this one is short,
 * dependency-free, and spreads single-character edits across the whole word,
 * which matters because consecutive turns differ by very little text.
 *
 * Exported for `diceAnim.ts`, which seeds the dice ANIMATION off the roll it is
 * showing: one hash means a re-thrown roll re-throws the same arc, and it is one
 * definition of "deterministic from a seed" rather than two that could drift.
 */
export function seedHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range without BigInt.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Murmur3's finalizer — the avalanche step FNV-1a doesn't have.
 *
 * Why it is needed: in FNV-1a the low bit of the output is nothing but the XOR
 * of the low bits of the input bytes (the prime is odd, so multiplying never
 * touches bit 0). Two seeds differing by a fixed suffix therefore have a FIXED
 * relationship in their low bit — and since `h % sides` has the same parity as
 * `h` for even `sides`, hashing `turn|action` and `turn|action|1` locked the two
 * dice of a 2d6 into opposite parities: **every sum came out even, and a 7 was
 * impossible.** The marginals looked perfect, which is why it survived — only
 * the joint distribution was broken.
 *
 * The shifts here mix the high bits down, so the low bits of the result depend
 * on the whole word and the lockstep disappears.
 */
function avalanche(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Golden-ratio odd constant — the usual per-stream step for a counter mixer. */
const GOLDEN = 0x9e3779b9;

/**
 * The turn's dice — pure in (turn, action text, rules). See the seeding note
 * above.
 *
 * One hash of the seed, avalanched, then a counter for the extra dice. Both
 * halves of that are load-bearing, and both replace something that looked
 * reasonable and rolled unfairly:
 *
 * - **The avalanche on the base.** A raw FNV-1a hash was fed to `% diceSides`
 *   directly. FNV's low bit is nothing but the XOR of the input bytes' low bits
 *   — multiplying by an odd prime never touches bit 0 — and `h % sides` has the
 *   same parity as `h` when `sides` is even. So a die's parity was a *predictable
 *   function of the seed's characters*: on a seed family where the turn's digits
 *   also appear in the action text the parities cancelled outright and a d6 could
 *   only roll 1, 3 or 5.
 * - **The counter for dice 2..n.** Those used to hash `turn|action|i` — a seed a
 *   suffix away from the first die's. FNV leaks a fixed relationship between
 *   seeds like that, which locked the dice into opposite parities: **2d6 could
 *   never roll 7.** Counting off one already-mixed base has no near-identical
 *   strings to leak between.
 *
 * The cost is that a roll is no longer the number the pre-`DiceRules` build would
 * have produced for the same (turn, action) — nothing recomputes a past roll
 * except `regenerateLastTurn`, and a fair die is worth more than replaying an
 * unfair one.
 */
export function rollDice(turn: number, action: string, rules: DiceRules = DEFAULT_DICE): number[] {
  const { diceCount, diceSides } = normalizeDice(rules);
  const base = avalanche(seedHash(`${turn}|${action.trim().toLowerCase()}`));
  const dice: number[] = [];
  for (let i = 0; i < diceCount; i++) {
    const h = i === 0 ? base : avalanche((base + Math.imul(i, GOLDEN)) >>> 0);
    dice.push((h % diceSides) + 1);
  }
  return dice;
}

/** The dice total for this turn. */
export function rollFor(turn: number, action: string, rules: DiceRules = DEFAULT_DICE): number {
  return rollDice(turn, action, rules).reduce((sum, d) => sum + d, 0);
}

/** Does this action read as something that can go wrong? */
export function isRisky(action: string, keywords: string[] = RISK_KEYWORDS): boolean {
  return keywords.some((k) => keywordHits(k, action));
}

/** Where a total lands, per the configured thresholds (default 5+ / 3–4 / 2−). */
export function bandFor(total: number, rules: DiceRules = DEFAULT_DICE): TurnOutcome {
  const { strongThreshold, mixedThreshold } = normalizeDice(rules);
  if (total >= strongThreshold) return "strong";
  if (total >= mixedThreshold) return "mixed";
  return "cost";
}

/**
 * Resolve this turn's stakes for the acting character (the PC).
 *
 * Strengths and Flaws are matched with the SAME keyword machinery the spotlight
 * uses for `strengthsRelevant`, so "what counts as relevant" can never drift
 * between the two blocks. Only the action itself is scanned — not the recent
 * beats — because the question is what the player is attempting right now, and
 * folding in scene context made almost every action match something.
 */
export function computeStakes(
  action: string,
  actor: PartyMember | undefined,
  turn: number,
  rules: StakeRules = DEFAULT_STAKE_RULES,
): StakeSignals {
  const dice = normalizeDice(rules);
  // `alwaysRoll` is the "everything is a check" table: no keyword has to match,
  // so ordinary conversation rolls too.
  const risky = rules.alwaysRoll || isRisky(action, rules.keywords);
  const actionKeywords = extractKeywords(action);

  const strengthsInPlay =
    risky && !!actor?.strengths && intersects(actionKeywords, extractKeywords(actor.strengths));
  const flawsInPlay =
    risky && !!actor?.flaws && intersects(actionKeywords, extractKeywords(actor.flaws));

  const rolled = rollDice(turn, action, dice);
  const roll = rolled.reduce((sum, d) => sum + d, 0);
  // Strengths and Flaws both apply when the action touches both — the player is
  // doing something they are good at in a way that plays to their weakness. With
  // the shipped ±1 that cancels exactly; a table that weights them differently
  // gets whichever way it leans.
  const modifier =
    (strengthsInPlay ? dice.strengthsBonus : 0) - (flawsInPlay ? dice.flawsPenalty : 0);
  const total = roll + modifier;

  return {
    risky,
    strengthsInPlay,
    flawsInPlay,
    dice: rolled,
    roll,
    modifier,
    total,
    outcome: risky ? bandFor(total, dice) : null,
    rules: dice,
  };
}

/**
 * A throw with no turn behind it — what RPG System's **Test Roll** shows.
 *
 * Same dice, same banding, and the same `StakeSignals` shape as a real turn, so
 * the preview cannot drift from what a turn will actually do. What it does NOT
 * have is an actor or an action: no Strengths, no Flaws, no modifier — a test of
 * the SYSTEM, not of a character's odds.
 *
 * The seed is a caller's argument rather than a `Math.random()` in here, so the
 * function stays pure; the screen passes a fresh one per press, which is the one
 * place in the app where a re-roll SHOULD give a different answer.
 */
export function previewRoll(rules: DiceRules, seed: string): StakeSignals {
  const dice = normalizeDice(rules);
  const rolled = rollDice(0, seed, dice);
  const roll = rolled.reduce((sum, d) => sum + d, 0);
  return {
    risky: true,
    strengthsInPlay: false,
    flawsInPlay: false,
    dice: rolled,
    roll,
    modifier: 0,
    total: roll,
    outcome: bandFor(roll, dice),
    rules: dice,
  };
}

/**
 * Human-readable reason for the modifier, for the prompt and the UI. Takes the
 * two flags rather than the whole signal set so a `TurnRoll` replayed from a
 * saved message and a freshly computed `StakeSignals` can never be worded
 * differently.
 */
export function modifierNote(s: { strengths?: boolean; flaws?: boolean }): string {
  if (s.strengths && s.flaws) return "strengths and flaws both in play";
  if (s.strengths) return "strengths in play";
  if (s.flaws) return "flaws in play";
  return "nothing in play";
}

/**
 * The roll as it is kept on the narrator message. Null when the action carried
 * no risk — nothing was rolled, so there is nothing to show.
 */
export function rollRecord(s: StakeSignals): TurnRoll | null {
  if (!s.outcome) return null;
  const { diceCount, diceSides } = normalizeDice(s.rules);
  return {
    roll: s.roll,
    modifier: s.modifier,
    total: s.total,
    count: diceCount,
    sides: diceSides,
    // The individual faces only mean something when there is more than one; a
    // single die's face IS the total.
    ...(diceCount > 1 ? { dice: s.dice } : {}),
    // Only written when true, so a plain roll stays a handful of numbers.
    ...(s.strengthsInPlay ? { strengths: true } : {}),
    ...(s.flawsInPlay ? { flaws: true } : {}),
  };
}

/**
 * How a band reads to the player. Here rather than in a component because two
 * things show it now — the beat's chip and the dice toss — and a band that is
 * called one thing while the dice are in the air and another once they have
 * landed reads as two different results.
 */
export const OUTCOME_LABEL: Record<TurnOutcome, string> = {
  strong: "Strong result",
  mixed: "Mixed result",
  cost: "It cost you",
};

/** Signed modifier, e.g. `+1` / `-1`. */
export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * The roll as one short line: `1d6 4 +1 = 5`, or just `1d6 4` when nothing
 * modified it — an unmodified roll needs no arithmetic spelled out. Multiple
 * dice show their faces too: `2d6 [4, 3] 7 +1 = 8`.
 *
 * Records written before the dice were configurable carry no `count`/`sides`
 * and read as the 1d6 they were rolled on.
 */
export function formatRoll(r: TurnRoll): string {
  const faces = r.dice && r.dice.length > 1 ? ` [${r.dice.join(", ")}]` : "";
  const base = `${r.count ?? 1}d${r.sides ?? 6}${faces} ${r.roll}`;
  return r.modifier === 0 ? base : `${base} ${signed(r.modifier)} = ${r.total}`;
}

/**
 * The bands, spelled out — the "what would this have needed" line. `5+ strong ·
 * 3–4 mixed · 2− cost` on the shipped dice; whatever the table's thresholds say
 * otherwise. A MIXED band squeezed to nothing (thresholds set equal) simply
 * isn't printed, rather than printing an empty range.
 */
export function bandScale(rules: DiceRules = DEFAULT_DICE): string {
  const { strongThreshold: strong, mixedThreshold: mixed } = normalizeDice(rules);
  if (mixed >= strong) return `${strong}+ strong · ${strong - 1}− cost`;
  const mixedBand = mixed === strong - 1 ? `${mixed}` : `${mixed}–${strong - 1}`;
  return `${strong}+ strong · ${mixedBand} mixed · ${mixed - 1}− cost`;
}

/**
 * The `OUTCOME — THIS TURN` block: the roll, the band, and the editable rule.
 * Empty string when the action carried no risk — an ordinary conversational
 * turn should cost no tokens and get no melodrama.
 *
 * Marked authoritative for the same reason the party roll call is: the model
 * will happily narrate a triumph over a "cost" if the block reads as advice.
 */
export function formatStakesBlock(signals: StakeSignals, rule: string): string {
  if (!signals.outcome) return "";
  const sign = signed(signals.modifier);
  const note = modifierNote({
    strengths: signals.strengthsInPlay,
    flaws: signals.flawsInPlay,
  });
  const faces = signals.dice.length > 1 ? ` [${signals.dice.join(", ")}]` : "";
  return [
    "OUTCOME — THIS TURN (authoritative: narrate THIS result; never soften it, upgrade it, or talk the player out of it)",
    `The action is a gamble. Rolled ${diceNotation(signals.rules)}${faces} ${signals.roll} ${sign} (${note}) = ${signals.total} → ${signals.outcome.toUpperCase()}.`,
    // The scale says how CLOSE it was — a 3 that needed a 4 is a different beat
    // from a 3 that needed a 12, and the narrator can only see that if told.
    `Scale: ${bandScale(signals.rules)}.`,
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
