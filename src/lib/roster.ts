import type {
  Character,
  CharacterOverride,
  GameState,
  LegacyRosterEntry,
  PartyMember,
  RosterEntry,
  Standing,
} from "../types";
import { PARTED_STANDINGS, PARTY_STANDINGS } from "../types";
import { formatAka } from "./names";

/**
 * Max companions in the scene at once (PC + 3). The BENCH is uncapped — it is
 * the stable, not the marching order. Defined here, not in `defaults.ts`, so
 * this module stays free of imports and the cap lives with the predicate that
 * enforces it.
 */
export const PARTY_LIMIT = 3;

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
 *
 * One `standing` ladder carries all of it — party membership, presence in the
 * scene, ally-but-not-companion, and how someone left. Two orthogonal flags
 * (`inParty` + `status`) could spell states nothing downstream could render:
 * an over-cap joiner used to land `inParty: false, status: "active"` and
 * appear in no prompt block and no screen.
 */

/** State for a character the adventure has never touched. */
export const DEFAULT_ENTRY: Omit<RosterEntry, "id"> = {
  standing: "none",
  lastSpokeTurn: 0,
};

/**
 * Read an entry written in ANY shape this app has shipped. Saves and — more
 * stubbornly — reversal snapshots buried in old messages carry the pre-ladder
 * `inParty` + `status` pair, so this keeps arriving forever.
 */
export function normalizeEntry(entry: LegacyRosterEntry): RosterEntry {
  const out: RosterEntry = {
    id: entry.id,
    standing: entry.standing ?? legacyStanding(entry),
    lastSpokeTurn: entry.lastSpokeTurn ?? 0,
  };
  if (entry.overrides) out.overrides = normalizeOverrides(entry.overrides);
  if (entry.condition) out.condition = entry.condition;
  return out;
}

/**
 * Strengths as ONE free-text field. Sheets written before the label was
 * dropped stored `{ name, description }`; a save, a reversal snapshot, a story
 * override or a replayed delta can still carry that shape, so every path that
 * reads strengths from storage folds it here. Anything else reads as blank.
 */
export function strengthsText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const { name, description } = value as { name?: unknown; description?: unknown };
    const label = typeof name === "string" ? name.trim() : "";
    const body = typeof description === "string" ? description.trim() : "";
    return label && body ? `${label} — ${body}` : label || body;
  }
  return "";
}

/**
 * The identity line every character block leads with — `Name (species, sex)`,
 * with blank parts dropping out. One helper, so the PC sheet, the party roster,
 * the NPC block and the side-call sheet can never describe a character
 * differently from each other. Lives here rather than in `prompt.ts` because
 * `cast.ts` needs it too and `prompt.ts` already imports `cast.ts`.
 */
export function formatIdentity(
  c: Pick<Character, "name" | "species" | "sex"> & { aliases?: Character["aliases"] },
): string {
  // Former names ride in the same parentheses as species and sex rather than a
  // clause of their own: the roster line already ends in a dash and the
  // description, and the job here is only to connect the name the history keeps
  // saying to the name the roll call says.
  const traits = [c.species, c.sex, formatAka(c)]
    .map((t) => (t ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const name = c.name.trim() || "(unnamed)";
  return traits ? `${name} (${traits})` : name;
}

/** The sheet fields `formatTraits` prints, on anything shaped like a sheet. */
type SheetTraits = Partial<
  Pick<Character, "personality" | "drive" | "strengths" | "flaws" | "notes">
>;

/**
 * The sheet lines every character block prints, in one order — Personality,
 * Drive, Strengths, Flaws, Notes — with blank fields dropping out. Callers
 * join and indent them; only the list and its order live here.
 *
 * Shared for the same reason `formatIdentity` is: the PC block, the party
 * roster and the NPC block are three views of one sheet and used to hold three
 * copies of this list, so a field added to one was silently missing from the
 * others.
 *
 * `condition` is deliberately NOT here. A mark is per-adventure state, not a
 * sheet field, and it is printed exactly once — in its own CONDITIONS block,
 * which is also the only place that says how to clear one.
 */
export function formatTraits(c: SheetTraits): string[] {
  return [
    c.personality ? `Personality: ${c.personality}` : "",
    c.drive ? `Drive: ${c.drive}` : "",
    c.strengths ? `Strengths: ${c.strengths}` : "",
    c.flaws ? `Flaws: ${c.flaws}` : "",
    // The player's own field. Read by the narrator, written by nobody but them.
    c.notes ? `Notes: ${c.notes}` : "",
  ].filter(Boolean);
}

/**
 * Fold a stored override onto the current field shapes. Returns the SAME
 * object when nothing needed changing — `normalizeRoster` reference-diffs it.
 */
function normalizeOverrides(overrides: CharacterOverride): CharacterOverride {
  const strengths = overrides.strengths;
  if (strengths === undefined || typeof strengths === "string") return overrides;
  return { ...overrides, strengths: strengthsText(strengths) };
}

/** `inParty` won; otherwise a non-active `status` is how they left. */
function legacyStanding(entry: LegacyRosterEntry): Standing {
  if (entry.inParty) return "active";
  if (entry.status === "departed" || entry.status === "fallen") return entry.status;
  return "none";
}

/**
 * Normalize a whole roster, returning the SAME array reference when every
 * entry was already current — `captureReversal` reference-diffs the roster, so
 * loading a modern save must not look like a change.
 */
export function normalizeRoster(roster: LegacyRosterEntry[]): RosterEntry[] {
  let changed = false;
  const out = roster.map((e) => {
    const next = normalizeEntry(e);
    if (
      e.standing !== next.standing ||
      e.lastSpokeTurn !== next.lastSpokeTurn ||
      e.overrides !== next.overrides ||
      e.condition !== next.condition ||
      "inParty" in e ||
      "status" in e
    ) {
      changed = true;
      return next;
    }
    return e as RosterEntry;
  });
  return changed ? out : (roster as RosterEntry[]);
}

/** Is this standing "one of ours", active or benched? */
export function isInParty(standing: Standing): boolean {
  return standing === "active" || standing === "benched";
}

/** This adventure's entry for `id`, or the default (never undefined). */
export function getEntry(roster: RosterEntry[], id: string): RosterEntry {
  return roster.find((e) => e.id === id) ?? { id, ...DEFAULT_ENTRY };
}

/** This adventure's standing for `id` — "none" when it has never touched them. */
export function standingOf(roster: RosterEntry[], id: string): Standing {
  return getEntry(roster, id).standing;
}

/** Base ⊕ this adventure's overrides ⊕ its per-run state. */
export function resolve(base: Character, entry?: RosterEntry): PartyMember {
  const e = entry ?? { id: base.id, ...DEFAULT_ENTRY };
  return {
    ...base,
    ...(e.overrides ?? {}),
    lastSpokeTurn: e.lastSpokeTurn,
    standing: e.standing,
    condition: e.condition ?? "",
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
 * Members at any of the given standings, in ROSTER order — that order is the
 * party order the strip renders, and the order companions were written.
 * Entries whose character has since been deleted are skipped, so restoring an
 * old save slot degrades gracefully instead of crashing. The PC never matches:
 * they hold no party slot and are not a companion.
 */
export function membersAt(
  characters: Character[],
  roster: RosterEntry[],
  standings: readonly Standing[],
): PartyMember[] {
  const out: PartyMember[] = [];
  for (const e of roster) {
    if (!standings.includes(e.standing)) continue;
    const base = characters.find((c) => c.id === e.id);
    if (!base || base.role !== "member") continue;
    out.push(resolve(base, e));
  }
  return out;
}

/**
 * The companions actually in the scene — the party slots, the spotlight, the
 * strip. This is the narrow "who is here right now" list; benched members are
 * yours but absent, so they are deliberately NOT in it.
 */
export function activeMembers(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember[] {
  return membersAt(characters, roster, ["active"]);
}

/** Party members sitting this scene out — still yours, not present. */
export function benchedMembers(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember[] {
  return membersAt(characters, roster, ["benched"]);
}

/** The whole company, active and benched — what the Party screen manages. */
export function partyMembers(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember[] {
  return membersAt(characters, roster, PARTY_STANDINGS);
}

/**
 * Important characters this adventure knows who are NOT companions — allies,
 * contacts, rivals. They hold no party slot and never take the spotlight; the
 * prompt reaches for their sheet only when the scene names them.
 */
export function npcMembers(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember[] {
  return membersAt(characters, roster, ["npc"]);
}

/**
 * The companions this adventure has LOST — departed or fallen. Named in the
 * prompt every turn so the narrator stops writing them into the scene: the
 * history window outlives membership, so a member who left three beats ago is
 * still all over the freshest context. Someone merely kicked is NOT here —
 * that is a party change, not a story exit.
 *
 * Roster order — the tail is the most recent departure.
 */
export function partedMembers(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember[] {
  return membersAt(characters, roster, PARTED_STANDINGS);
}

/** The player character, resolved. */
export function playerCharacter(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember | undefined {
  const pc = characters.find((c) => c.role === "pc");
  return pc ? resolve(pc, roster.find((e) => e.id === pc.id)) : undefined;
}

/** PC + companions in the scene — the people whose gear is on the scene. */
export function presentMembers(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember[] {
  const pc = playerCharacter(characters, roster);
  const active = activeMembers(characters, roster);
  return pc ? [pc, ...active] : active;
}

/**
 * How many party slots are taken. ACTIVE members only — the bench is unlimited
 * on purpose, so it can hold a whole stable of companions without starving the
 * scene. Counted through `activeMembers` so the count is the same predicate as
 * the list: an entry the library can no longer resolve (a reversal snapshot or
 * a restored save can name a character deleted since) must not hold a slot that
 * shows nobody.
 */
export function partyCount(characters: Character[], roster: RosterEntry[]): number {
  return activeMembers(characters, roster).length;
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
  // Every mutable field of RosterEntry must be compared here — a field left
  // out silently makes its changes invisible to `captureReversal`, which
  // reference-diffs the roster to decide whether the turn touched it.
  if (
    next.standing === cur.standing &&
    next.lastSpokeTurn === cur.lastSpokeTurn &&
    next.overrides === cur.overrides &&
    next.condition === cur.condition
  ) {
    return roster;
  }
  const out = roster.slice();
  out[i] = next;
  return out;
}

/** Move a character to a standing in this adventure. */
export function setStanding(
  roster: RosterEntry[],
  id: string,
  standing: Standing,
): RosterEntry[] {
  return setEntry(roster, id, { standing });
}

/**
 * Set — or clear — this adventure's mark on a character (`stakes.ts` COST
 * outcomes, and the player, write here).
 *
 * A blank condition DELETES the key rather than storing `""`, so "cleared" and
 * "never marked" are the same stored shape. `normalizeEntry` drops blanks on
 * load for the same reason: `captureReversal` reference-diffs the roster, and a
 * save round-trip that resurrects a `condition: ""` would read as a change the
 * turn made.
 */
export function setCondition(
  roster: RosterEntry[],
  id: string,
  condition: string,
): RosterEntry[] {
  const text = condition.trim();
  const i = roster.findIndex((e) => e.id === id);
  if (i === -1) {
    if (!text) return roster;
    return [...roster, { id, ...DEFAULT_ENTRY, condition: text }];
  }
  if ((roster[i].condition ?? "") === text) return roster;

  const next = { ...roster[i] };
  if (text) next.condition = text;
  else delete next.condition;
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

/**
 * Fold characters from another copy of the library into this one, by id.
 * Whoever is already here wins — the other copy may be older than an edit.
 *
 * Written for the legacy-save split (a pre-split save still carrying its cast)
 * and reused by cloud sync, where it is why the cast is the one document that
 * never has to ask the player anything: two devices that each authored a
 * companion both keep theirs, and an edit made here is not undone by the
 * version the other device happens to hold.
 */
export function mergeLibrary(library: Character[], incoming: Character[]): Character[] {
  const known = new Set(library.map((c) => c.id));
  const extra = incoming.filter((c) => !known.has(c.id));
  return extra.length ? [...library, ...extra] : library;
}
