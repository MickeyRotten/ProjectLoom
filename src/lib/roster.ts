import type {
  Character,
  CharacterOverride,
  GameState,
  PartyMember,
  RosterEntry,
} from "../types";
import { PARTY_LIMIT } from "./defaults";

/**
 * The join between the two halves of the cast model:
 *
 *  - the GLOBAL character library (`Character[]`, outlives every adventure), and
 *  - the ACTIVE adventure's roster (`GameState.roster`, per-run membership,
 *    last-spoke tracking, status and story-written field overrides).
 *
 * Everything downstream — prompt, spotlight, images, UI — consumes `PartyMember`
 * values produced here, never the raw halves. Keeping this pure is what makes
 * the split testable, and it collapses the `role === "member" && inParty`
 * predicate that used to be re-implemented at eight call sites.
 */

/** State for a character the adventure has never touched. */
export const DEFAULT_ENTRY: Omit<RosterEntry, "id"> = {
  inParty: false,
  lastSpokeTurn: 0,
  status: "active",
};

/** This adventure's entry for `id`, or the default (never undefined). */
export function getEntry(roster: RosterEntry[], id: string): RosterEntry {
  return roster.find((e) => e.id === id) ?? { id, ...DEFAULT_ENTRY };
}

/** Base ⊕ this adventure's overrides ⊕ its per-run state. */
export function resolve(base: Character, entry?: RosterEntry): PartyMember {
  const e = entry ?? { id: base.id, ...DEFAULT_ENTRY };
  return {
    ...base,
    ...(e.overrides ?? {}),
    lastSpokeTurn: e.lastSpokeTurn,
    inParty: e.inParty,
    status: e.status,
  };
}

/** Every character resolved against this adventure, in library order. */
export function allMembers(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember[] {
  return characters.map((c) => resolve(c, roster.find((e) => e.id === c.id)));
}

/**
 * The in-party companions, in ROSTER order — that order is the party order the
 * strip renders. Entries whose character has since been deleted are skipped, so
 * restoring an old save slot degrades gracefully instead of crashing.
 */
export function partyMembers(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember[] {
  const out: PartyMember[] = [];
  for (const e of roster) {
    if (!e.inParty) continue;
    const base = characters.find((c) => c.id === e.id);
    if (!base || base.role !== "member") continue;
    out.push(resolve(base, e));
  }
  return out;
}

/** The player character, resolved. */
export function playerCharacter(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember | undefined {
  const pc = characters.find((c) => c.role === "pc");
  return pc ? resolve(pc, roster.find((e) => e.id === pc.id)) : undefined;
}

/** PC + in-party companions — the people whose gear is on the scene. */
export function presentMembers(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember[] {
  const pc = playerCharacter(characters, roster);
  const party = partyMembers(characters, roster);
  return pc ? [pc, ...party] : party;
}

/**
 * How many party slots are taken. Counted through `partyMembers` on purpose, so
 * the count is the same predicate as the list — an entry the library can no
 * longer resolve (a reversal snapshot or a restored save can name a character
 * deleted since) must not hold a slot that shows nobody.
 */
export function partyCount(characters: Character[], roster: RosterEntry[]): number {
  return partyMembers(characters, roster).length;
}

export function partyFull(characters: Character[], roster: RosterEntry[]): boolean {
  return partyCount(characters, roster) >= PARTY_LIMIT;
}

/**
 * Drop entries whose character the library no longer has. Reversal snapshots
 * predate a deletion, so undoing a turn taken before one resurrects that
 * character's entry; nothing can resolve it, so it is dead weight in the
 * adventure — and in every reversal captured after it.
 *
 * Returns the SAME array reference when nothing changed (see `setEntry`).
 */
export function pruneRoster(
  characters: Character[],
  roster: RosterEntry[],
): RosterEntry[] {
  const out = roster.filter((e) => characters.some((c) => c.id === e.id));
  return out.length === roster.length ? roster : out;
}

/**
 * Patch one entry, appending it when the character has no entry yet. Returns
 * the SAME array reference when nothing actually changed — `captureReversal`
 * reference-diffs the roster to decide whether a turn touched it, so a no-op
 * must not allocate.
 */
export function setEntry(
  roster: RosterEntry[],
  id: string,
  patch: Partial<Omit<RosterEntry, "id">>,
): RosterEntry[] {
  const i = roster.findIndex((e) => e.id === id);
  if (i === -1) {
    const entry: RosterEntry = { id, ...DEFAULT_ENTRY, ...patch };
    return [...roster, entry];
  }
  const cur = roster[i];
  const next = { ...cur, ...patch };
  if (
    next.inParty === cur.inParty &&
    next.lastSpokeTurn === cur.lastSpokeTurn &&
    next.status === cur.status &&
    next.overrides === cur.overrides
  ) {
    return roster;
  }
  const out = roster.slice();
  out[i] = next;
  return out;
}

/** Merge story-written field changes onto an entry's overrides. */
export function mergeOverrides(
  roster: RosterEntry[],
  id: string,
  overrides: CharacterOverride,
): RosterEntry[] {
  if (!Object.keys(overrides).length) return roster;
  const cur = getEntry(roster, id);
  return setEntry(roster, id, { overrides: { ...(cur.overrides ?? {}), ...overrides } });
}

/**
 * Drop the given keys from an entry's overrides — used when the player saves a
 * sheet, so their own text isn't immediately masked by an older story change.
 * Passing no keys clears every override ("Revert Story Changes").
 */
export function clearOverrides(
  roster: RosterEntry[],
  id: string,
  keys?: (keyof CharacterOverride)[],
): RosterEntry[] {
  const i = roster.findIndex((e) => e.id === id);
  if (i === -1 || !roster[i].overrides) return roster;

  let overrides: CharacterOverride | undefined;
  if (keys) {
    overrides = { ...roster[i].overrides };
    for (const k of keys) delete overrides[k];
    if (!Object.keys(overrides).length) overrides = undefined;
  }
  if (overrides === roster[i].overrides) return roster;

  const out = roster.slice();
  const next = { ...roster[i] };
  if (overrides) next.overrides = overrides;
  else delete next.overrides;
  out[i] = next;
  return out;
}

/** Does the story have any pending divergence from the authored character? */
export function hasOverrides(roster: RosterEntry[], id: string): boolean {
  const e = roster.find((x) => x.id === id);
  return !!e?.overrides && Object.keys(e.overrides).length > 0;
}

/** Forget a character entirely (they were deleted from the library). */
export function dropEntry(roster: RosterEntry[], id: string): RosterEntry[] {
  return roster.some((e) => e.id === id) ? roster.filter((e) => e.id !== id) : roster;
}

/** Convenience for callers that already hold the whole game. */
export function gameParty(game: GameState, characters: Character[]): PartyMember[] {
  return partyMembers(characters, game.roster);
}
