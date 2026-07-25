import type { GameState, Reversal, RosterEntry } from "../types";
import { normalizeRoster } from "./roster";

/**
 * Phase 5 reversal (loom-turn-protocol: "swipe/regenerate/delete unwinds").
 *
 * The applied <<<LOOM>>> block is op-based and lossy to invert — a party
 * `remove` changes standing rather than deleting, an inventory `add` merges quantity, an
 * `update` drops the prior value — so rather than reconstruct an inverse block
 * we snapshot the exact pre-turn slices the turn is about to overwrite. Undo
 * restores them wholesale: exact, pure, order-preserving.
 *
 * Slices are captured by reference-diffing the pre- and post-turn game, which
 * is exact because the pure delta/spotlight pipeline only allocates a new array
 * for a slice it actually changed (`applyDeltas` returns the same reference when
 * a block omits that array; the spotlight only remaps `roster` when someone
 * spoke). So a plain narration turn stores just the three scalars.
 *
 * The global character LIBRARY is deliberately never captured. Undoing a turn
 * that recruited someone un-parties them (the roster restore does that) but
 * leaves the character in Characters — only the player ever deletes a
 * character, and not capturing it means an undo can't clobber a library edit
 * made since the turn ran.
 */
export function captureReversal(pre: GameState, post: GameState): Reversal {
  const rev: Reversal = { day: pre.day, location: pre.location, weather: pre.weather };
  if (pre.roster !== post.roster) rev.roster = pre.roster;
  if (pre.inventory !== post.inventory) rev.inventory = pre.inventory;
  if (pre.quests !== post.quests) rev.quests = pre.quests;
  return rev;
}

/**
 * Restore a game to its pre-turn slices from a captured reversal (pure).
 *
 * Snapshots live inside saved messages, so a reversal written before the
 * `standing` ladder keeps arriving for the life of the save — every restored
 * roster goes through `normalizeRoster`, which returns the same reference when
 * the entries were already current.
 */
export function applyReversal(game: GameState, rev: Reversal): GameState {
  const roster = rev.roster ?? legacyRoster(rev);
  return {
    ...game,
    day: rev.day,
    location: rev.location,
    weather: rev.weather,
    roster: roster ? normalizeRoster(roster) : game.roster,
    inventory: rev.inventory ?? game.inventory,
    quests: rev.quests ?? game.quests,
  };
}

/**
 * Turns recorded before the Characters/Party split stored the whole character
 * array. Rebuild entries from it so undo still works on that history.
 */
function legacyRoster(rev: Reversal): RosterEntry[] | undefined {
  if (!rev.characters) return undefined;
  return rev.characters.map((c) => ({
    id: c.id,
    standing: c.role === "member" && c.inParty ? ("active" as const) : ("none" as const),
    lastSpokeTurn: c.lastSpokeTurn ?? 0,
  }));
}
