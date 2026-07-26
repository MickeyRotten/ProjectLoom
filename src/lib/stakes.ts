import type { PartyMember, TurnOutcome } from "../types";
import { extractKeywords, intersects } from "./spotlight";
import { keywordHits } from "./worldNotes";

/**
 * Stakes — deterministic, single-call, in the same shape as the spotlight
 * (`spotlight.ts`; read that first, this is its sibling).
 *
 * NO extra LLM call, and no asking the narrator how it went. Every turn we
 * decide on-device whether the player's action carries risk, roll a d6 that is
 * a pure function of (turn, action text), modify it by whether the action leans
 * on the actor's Strengths or their Flaws, and hand the narrator ONE outcome
 * band it must honour. The narrator writes the prose; it does not get to pick
 * the result.
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
 * Verbs and nouns that make an action a gamble. Word-boundary matched via the
 * World Notes matcher, so one definition of "mentioned" serves lore, cast, and
 * risk alike.
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

export interface StakeSignals {
  /** The action reads as an attempt that can fail. Gates everything below. */
  risky: boolean;
  /** The action leans on the acting character's Strengths. */
  strengthsInPlay: boolean;
  /** The action leans on the acting character's Flaws. */
  flawsInPlay: boolean;
  /** The raw d6 for this turn, 1–6. */
  roll: number;
  /** Strengths/Flaws modifier applied to the roll (−1, 0, or +1). */
  modifier: number;
  /** `roll + modifier`. */
  total: number;
  /** The band `total` fell into — null when the action carried no risk. */
  outcome: TurnOutcome | null;
}

/**
 * FNV-1a over the seed string. Any stable hash would do; this one is short,
 * dependency-free, and spreads single-character edits across the whole word,
 * which matters because consecutive turns differ by very little text.
 */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range without BigInt.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The turn's d6 — pure in (turn, action text). See the seeding note above. */
export function rollFor(turn: number, action: string): number {
  return (hash(`${turn}|${action.trim().toLowerCase()}`) % 6) + 1;
}

/** Does this action read as something that can go wrong? */
export function isRisky(action: string): boolean {
  return RISK_KEYWORDS.some((k) => keywordHits(k, action));
}

/** Where a total lands. 5+ strong · 3–4 mixed · 2− cost. */
export function bandFor(total: number): TurnOutcome {
  if (total >= 5) return "strong";
  if (total >= 3) return "mixed";
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
): StakeSignals {
  const risky = isRisky(action);
  const actionKeywords = extractKeywords(action);

  const strengthsInPlay =
    risky && !!actor?.strengths && intersects(actionKeywords, extractKeywords(actor.strengths));
  const flawsInPlay =
    risky && !!actor?.flaws && intersects(actionKeywords, extractKeywords(actor.flaws));

  const roll = rollFor(turn, action);
  // Strengths and Flaws cancel when the action touches both — the player is
  // doing something they are good at in a way that plays to their weakness,
  // which is exactly an even-odds moment.
  const modifier = (strengthsInPlay ? 1 : 0) + (flawsInPlay ? -1 : 0);
  const total = roll + modifier;

  return {
    risky,
    strengthsInPlay,
    flawsInPlay,
    roll,
    modifier,
    total,
    outcome: risky ? bandFor(total) : null,
  };
}

/** Human-readable reason for the modifier, for the prompt and the UI. */
function modifierNote(s: StakeSignals): string {
  if (s.strengthsInPlay && s.flawsInPlay) return "strengths and flaws both in play";
  if (s.strengthsInPlay) return "strengths in play";
  if (s.flawsInPlay) return "flaws in play";
  return "nothing in play";
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
  const sign = signals.modifier >= 0 ? `+${signals.modifier}` : `${signals.modifier}`;
  return [
    "OUTCOME — THIS TURN (authoritative: narrate THIS result; never soften it, upgrade it, or talk the player out of it)",
    `The action is a gamble. Rolled ${signals.roll} ${sign} (${modifierNote(signals)}) = ${signals.total} → ${signals.outcome.toUpperCase()}.`,
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
