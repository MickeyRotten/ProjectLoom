import type {
  Character,
  ConditionDelta,
  Equipment,
  GameState,
  InventoryDelta,
  Item,
  LoomBlock,
  Note,
  NoteDelta,
  PartyDelta,
  Quest,
  QuestDelta,
  RosterEntry,
  Standing,
} from "../types";
import { isGold } from "./defaults";
import {
  getEntry,
  partyFull,
  setCondition,
  setStanding,
  standingOf,
  strengthsText,
} from "./roster";

/**
 * Apply a parsed <<<LOOM>>> block to the active game (loom-turn-protocol):
 *  - location/day/weather OVERWRITE the scene.
 *  - party/inventory/quests are OP-BASED (add | update | remove), keyed by
 *    slugged name/label.
 *
 * Party ops span BOTH halves of the cast model. Names are matched against the
 * whole global character library, so a companion written in an earlier
 * adventure is re-used — portrait, sheet and all — instead of duplicated. What
 * an op writes depends on which half owns it:
 *  - membership / standing / last-spoke → this adventure's roster;
 *  - a brand-new character's sheet → the library, written ONCE at creation.
 * A character who already exists is FROZEN: their species, sex, appearance,
 * personality, drive, strengths, flaws and equipment are the player's, and no later delta —
 * `add` or `update` — touches them. Sheet drift was the story quietly
 * rewriting a cast the player had authored, one turn at a time; the narration
 * is where a character changes now. `remove` only changes standing (and
 * records why); nothing the model emits ever deletes a character.
 *
 * Pure: returns the changed slices; callers merge into the store. Keeping this
 * pure is what makes the turn contract testable.
 */
export interface AppliedScene {
  day: number;
  location: string;
  weather: string;
  characters: Character[];
  roster: RosterEntry[];
  inventory: Item[];
  quests: Quest[];
  worldNotes: Note[];
}

/**
 * How a name or a label is matched everywhere in this app — case, punctuation
 * and spacing folded away. Exported so gear moving between the pack and a
 * character's kit (`equip.ts`) matches rows the SAME way the narrator's deltas
 * do; two spellings of "match" is how an item ends up listed twice.
 */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Separators a model uses to staple a parent place onto the actual one —
 * "Boars Head Tavern - Damp Cellar", "Rodstroke: Market Square",
 * "Murkwood / Old Well". All are surrounded by whitespace, or are a colon, so a
 * hyphenated single name ("Half-Moon Inn") is never split.
 *
 * Commas are deliberately absent: "Rodstroke, Mesmeria" nests the other way
 * round, and taking the last part there would name the country instead of the
 * room.
 */
const LOCATION_JOINERS = /\s+[-–—>|/]\s+|\s*:\s+/;

/**
 * The one place the scene is in, out of whatever the narrator wrote. A location
 * is a NAME — the most specific one — because it is a scene label in the header
 * and the cache key behind its image; a compound like "Boars Head Tavern - Damp
 * Cellar" is a different key from "Damp Cellar", so the same room is drawn
 * twice and reads as a new place every time the model changes its mind about
 * the prefix.
 *
 * Takes the LAST segment: with these joiners the tail is the narrower place.
 * Returns "" for input that is only separators, so callers can keep the
 * previous scene rather than blank it.
 */
export function simplifyLocation(location: string): string {
  const parts = location
    .split(LOCATION_JOINERS)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/**
 * Fold a parsed block down to the ops that actually SAY something, before
 * anything applies or records it.
 *
 * The narrator restates. Asked every turn what changed, a model will re-emit an
 * acquisition it already reported — the rusty key it handed over three beats
 * ago, named again because the key is still in the scene. Most channels shrug
 * that off (a quest `add` on an existing label is a no-op, a note `add` merges,
 * a party `add` only re-seats), but inventory MERGES QUANTITY: a restated
 * `add` is +1 every time it lands, and the purse fills with Rusty Key ×7.
 *
 * ONE RULE, applied to every channel: **an op that would change nothing is not
 * an op.** A row is dropped when the state it asks for is the state already
 * there — a condition re-stating a mark someone already carries, an `update`
 * setting a quantity to the number it already is, a quest `add` for a quest
 * already on the board, a party `add` re-seating someone already sitting there,
 * a `remove` for something not held. Plus the two special cases the shape of
 * the data creates:
 *  - an exact-duplicate row inside ONE block is written once;
 *  - an inventory `add` for an item already held, carrying NO quantity, is a
 *    restatement rather than an acquisition — dropped, or demoted to the
 *    `update` it meant if it brought a new description. An `add` WITH a
 *    quantity is always honoured: "picked up 2 more torches" is a real event,
 *    and second-guessing it would be the opposite bug.
 *
 * Why the no-op rule earns its keep twice over: the state is unharmed either
 * way (applying "set X to what X already is" is free), but the transcript is
 * not. `toasts.ts` derives its chips from the RECORDED block, so a narrator
 * that re-states the player's condition every turn stamps "Hiro: Armed with a
 * strange, glowing sword" onto four beats in a row, and a Gold `update` that
 * repeats the current total reads as though money changed hands. A chip is a
 * claim that something happened. Dropping the row is what makes it true.
 *
 * Runs BEFORE `applyDeltas`, and the result is what the store both applies and
 * records.
 *
 * Pure, and reference-stable: a block with nothing to fold is returned as-is,
 * so the common turn allocates nothing.
 */
export function reconcileBlock(
  game: GameState,
  characters: Character[],
  block: LoomBlock,
  /**
   * This turn's narration, for the one check that needs it (`goldIsNarrated`).
   * Optional: callers with no prose to hand simply skip that check.
   */
  prose = "",
): LoomBlock {
  const party = reconcileParty(characters, game.roster, dropRepeats(block.party));
  const conditions = reconcileConditions(
    characters,
    game.roster,
    dropRepeats(block.conditions),
  );
  const inventory = reconcileInventory(game.inventory, dropRepeats(block.inventory), prose);
  const quests = reconcileQuests(game.quests, dropRepeats(block.quests));
  const notes = reconcileNotes(game.worldNotes, dropRepeats(block.notes));

  if (
    party === block.party &&
    conditions === block.conditions &&
    inventory === block.inventory &&
    quests === block.quests &&
    notes === block.notes
  ) {
    return block;
  }

  return { ...block, party, conditions, inventory, quests, notes };
}

/**
 * The same op row emitted twice in one block, written once. Rows are compared
 * on their whole content with keys sorted, so field order — which is the
 * model's, not ours — can't make one copy look different from the other.
 *
 * Only EXACT repeats go: two `add` rows for the same label with different
 * quantities are a sequence, not a stutter, and are left alone.
 */
function dropRepeats<T>(rows: T[] | undefined): T[] | undefined {
  if (!rows?.length) return rows;
  const seen = new Set<string>();
  const kept = rows.filter((row) => {
    const key = rowKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return kept.length === rows.length ? rows : kept;
}

/** Content key for one delta row — field order normalized away. */
function rowKey(row: unknown): string {
  if (!row || typeof row !== "object") return String(row);
  // The array replacer filters object properties at every depth; array VALUES
  // (a note's keywords) are untouched by it, so they still count.
  return JSON.stringify(row, Object.keys(row as object).sort());
}

/**
 * Walk a channel's rows, keeping / rewriting / dropping each. A fold returning
 * the row itself keeps it, a new object replaces it, `null` drops it. The
 * original array comes back untouched when every row survived unchanged, which
 * is what keeps `reconcileBlock` allocation-free on an ordinary turn.
 */
function foldRows<T>(rows: T[] | undefined, fold: (row: T) => T | null): T[] | undefined {
  if (!rows?.length) return rows;
  let changed = false;
  const kept: T[] = [];
  for (const row of rows) {
    const out = fold(row);
    if (out === row) {
      kept.push(row);
      continue;
    }
    changed = true;
    if (out !== null) kept.push(out);
  }
  return changed ? kept : rows;
}

/**
 * Inventory ops with the restatements and the no-ops taken out. Tracks the pack
 * AS THE BLOCK RUNS — an item this same block just picked up counts as held for
 * the rows after it, and a row that changes a count moves the number the next
 * row is compared against.
 */
function reconcileInventory(
  current: Item[],
  deltas: InventoryDelta[] | undefined,
  prose: string,
): InventoryDelta[] | undefined {
  const held = new Map(current.map((it) => [slug(it.label), it]));
  const narrated = goldIsNarrated(prose);

  return foldRows(deltas, (d) => {
    if (!d?.label) return d;
    const key = slug(d.label);
    const item = held.get(key);
    // A Gold row that MOVES the total has to be earned in the prose — see
    // `goldIsNarrated`. Rows that leave the total alone are judged as no-ops
    // below, like any other row.
    const gold = isGold(d.label);

    if (d.op === "remove") {
      // Nothing to take away, so nothing happened — and a "removed from
      // inventory" chip for an item the player never had is pure fiction.
      if (!item) return null;
      if (gold) {
        // Gold is never actually gone: a remove empties the purse and the row
        // survives, so the item stays "held" for the rows that follow.
        if (item.quantity === 0) return null;
        if (!narrated) return null;
        held.set(key, { ...item, quantity: 0 });
        return d;
      }
      held.delete(key);
      return d;
    }

    if (d.op === "update") {
      // An update names a row that must already exist; `applyInventory` drops
      // it otherwise, and a chip for it would report a change to nothing.
      if (!item) return null;
      const description = d.description ?? item.description;
      const quantity = d.quantity ?? item.quantity;
      if (description === item.description && quantity === item.quantity) return null;
      if (gold && quantity !== item.quantity && !narrated) return null;
      held.set(key, { ...item, description, quantity });
      return d;
    }

    // add — a NEW acquisition. Without a quantity, on something already held,
    // it is the narrator restating possession, not the player picking anything
    // up: the pack keeps what it has, and only a fresh description survives, as
    // the `update` the row meant.
    if (item && d.quantity === undefined) {
      if (d.description === undefined || d.description === item.description) return null;
      held.set(key, { ...item, description: d.description });
      return { op: "update", label: d.label, description: d.description };
    }

    const quantity = d.quantity ?? 1;
    if (gold && !narrated) return null;
    held.set(
      key,
      item
        ? { ...item, quantity: item.quantity + quantity, description: d.description ?? item.description }
        : { label: d.label, description: d.description ?? "", quantity },
    );
    return d;
  });
}

/**
 * Words that mean money changed hands. A Gold row that moves the total is
 * accepted only when the beat it rides on contains one of them.
 *
 * This is the one check in here that reads the prose, and it exists because
 * Gold is the field a narrator will restate and then quietly improvise: asked
 * every turn what changed, and shown "Gold ×15" in INVENTORY every turn, it
 * starts answering with a number — 15, then 25, then 45 — across beats about
 * mushrooms and satchels where not a coin is mentioned. Restated totals are
 * caught as no-ops; an invented one is a real change, and the only evidence
 * that it never happened is the narration itself.
 *
 * Deliberately generous, because the cost is asymmetric: a missed word silently
 * withholds money the player earned, so the list covers the verbs of paying and
 * the nouns of coin, and any Gold row is let through when there is no prose to
 * judge (a caller that passes none is not making a claim about the beat).
 */
const MONEY_WORDS = [
  "gold",
  "coins?",
  "coppers?",
  "silvers?",
  "purses?",
  "pouch(es)?",
  "money",
  "cash",
  "currency",
  "funds?",
  "pay(s|ing|ment|ments)?",
  "paid",
  "spend(s|ing)?",
  "spent",
  "prices?",
  "costs?",
  "fees?",
  "rewards?",
  "bribes?",
  "wages?",
  "tolls?",
  "ransoms?",
  "treasures?",
  "loot(s|ed|ing)?",
  "buy(s|ing)?",
  "bought",
  "sells?",
  "sold",
  "haggl(e|es|ed|ing)",
  "barter(s|ed|ing)?",
];

const MONEY_RE = new RegExp(`(?<![\\w])(${MONEY_WORDS.join("|")})(?![\\w])`, "i");

/** Does this beat say money moved? Blank prose is not a claim either way. */
export function goldIsNarrated(prose: string): boolean {
  if (!prose.trim()) return true;
  return MONEY_RE.test(prose);
}

/**
 * Conditions that would rewrite a mark to the words already on it, dropped.
 * This is the channel restatement hurts most: a mark is not a change, it is a
 * STATE, so a narrator that keeps re-reporting "Armed with a strange, glowing
 * sword" leaves the same chip on every beat until the sword is gone.
 */
function reconcileConditions(
  characters: Character[],
  roster: RosterEntry[],
  deltas: ConditionDelta[] | undefined,
): ConditionDelta[] | undefined {
  const marks = new Map<string, string>();

  return foldRows(deltas, (d) => {
    if (!d?.name || typeof d.condition !== "string") return d;
    const key = slug(d.name);
    const found = characters.find((c) => slug(c.name) === key);
    // Nobody by that name — `applyConditions` ignores the row, so a chip for it
    // would mark a person the game has never heard of.
    if (!found) return null;
    const current = marks.get(found.id) ?? getEntry(roster, found.id).condition ?? "";
    const next = d.condition.trim();
    if (next === current.trim()) return null;
    marks.set(found.id, next);
    return d;
  });
}

/** Quest ops that would leave the board exactly as it is, dropped. */
function reconcileQuests(current: Quest[], deltas: QuestDelta[] | undefined): QuestDelta[] | undefined {
  const board = new Map(current.map((q) => [slug(q.label), q]));

  return foldRows(deltas, (d) => {
    if (!d?.label) return d;
    const key = slug(d.label);
    const quest = board.get(key);

    if (d.op === "remove") return quest ? (board.delete(key), d) : null;

    if (d.op === "add") {
      // `applyQuests` no-ops an add on a quest already on the board — the chip
      // would announce a quest the player started turns ago.
      if (quest) return null;
      board.set(key, {
        id: "",
        label: d.label,
        description: d.description ?? "",
        reward: d.reward ?? "",
        status: d.status ?? "active",
      });
      return d;
    }

    if (!quest) return null;
    const next = {
      ...quest,
      description: d.description ?? quest.description,
      reward: d.reward ?? quest.reward,
      status: d.status ?? quest.status,
    };
    if (
      next.description === quest.description &&
      next.reward === quest.reward &&
      next.status === quest.status
    ) {
      return null;
    }
    board.set(key, next);
    return d;
  });
}

/**
 * Note ops that would write back what the note already says, dropped. Mirrors
 * `applyNotes`' own no-op test — the one that keeps a note-only turn from
 * recording a reversal snapshot — so the chip and the state agree.
 */
function reconcileNotes(current: Note[], deltas: NoteDelta[] | undefined): NoteDelta[] | undefined {
  const known = new Map(current.map((n) => [slug(n.title), n]));

  return foldRows(deltas, (d) => {
    if (!d?.title) return d;
    const key = slug(d.title);
    const note = known.get(key);

    if (d.op === "remove") return note ? (known.delete(key), d) : null;

    const keywords = noteKeywords(d.keywords);
    if (!note) {
      known.set(key, { id: "", title: d.title, keywords: keywords ?? [], content: d.content ?? "" });
      return d;
    }
    const content = d.content ?? note.content;
    const merged = keywords ? mergeKeywords(note.keywords, keywords) : note.keywords;
    if (content === note.content && merged === note.keywords) return null;
    known.set(key, { ...note, content, keywords: merged });
    return d;
  });
}

/**
 * Party ops that would leave someone exactly where they already stand, dropped.
 * Standing is all a party op can move (a sheet freezes at creation), so a row
 * asking for the standing already recorded is asking for nothing.
 *
 * An `add` naming somebody NEW is never a no-op — that one creates a character.
 */
function reconcileParty(
  characters: Character[],
  roster: RosterEntry[],
  deltas: PartyDelta[] | undefined,
): PartyDelta[] | undefined {
  const seats = new Map<string, Standing>();
  const seatOf = (id: string) => seats.get(id) ?? standingOf(roster, id);

  return foldRows(deltas, (d) => {
    if (!d?.name) return d;
    const key = slug(d.name);
    const found = characters.find((c) => c.role === "member" && slug(c.name) === key);

    if (d.op === "remove") {
      if (!found) return null;
      const want = exitStanding(d);
      if (want === seatOf(found.id)) return null;
      seats.set(found.id, want);
      return d;
    }

    if (d.op === "update") {
      // Standing is the whole of an update; without one `applyParty` skips the
      // row outright.
      if (!found || !d.standing) return null;
      if (d.standing === seatOf(found.id)) return null;
      seats.set(found.id, d.standing);
      return d;
    }

    // add — creation is always a change; seating someone is one only if it
    // moves them. The dead are never re-recruited, so an `add` naming them is
    // skipped by `applyParty` and must not chip either.
    if (!found) return d;
    const here = seatOf(found.id);
    if (here === "fallen") return null;
    const want = d.standing ?? "active";
    if (want === here) return null;
    seats.set(found.id, want);
    return d;
  });
}

export function applyDeltas(
  game: GameState,
  characters: Character[],
  block: LoomBlock,
): AppliedScene {
  const day = block.day ?? game.day;
  const location =
    block.location === undefined ? game.location : simplifyLocation(block.location) || game.location;
  const weather = block.weather ?? game.weather;
  const party = applyParty(characters, game.roster, block);
  // Conditions run AFTER the party ops, so a companion introduced and wounded
  // in the same block can be marked — they exist in `party.characters` by then.
  const roster = applyConditions(party.characters, party.roster, block);

  return {
    day,
    location,
    weather,
    characters: party.characters,
    roster,
    inventory: applyInventory(game.inventory, block),
    quests: applyQuests(game.quests, block),
    worldNotes: applyNotes(game.worldNotes, block),
  };
}

/**
 * Op-based party membership, keyed by slugged character name across the whole
 * library. Only members (role "member") are matched — the PC is never touched
 * by a party delta.
 *  - add: bring a known character into the adventure, or CREATE one in the
 *    library from the delta's fields. Creation is the only path that writes a
 *    sheet — including their starting `equipment`; seating a character who
 *    already exists ignores every field but `standing`. `standing` says how they join — `active` (default),
 *    `benched`, or `npc` for an ally who is not a companion. An `active` join
 *    respects PARTY_LIMIT: past the cap they land BENCHED rather than in a
 *    state nothing renders. A `fallen` character is never re-recruited by the
 *    narrator; only the player can bring them back.
 *  - update: move an existing character's standing. Nothing else — the sheet is
 *    frozen after creation — and it never creates.
 *  - remove: they stop travelling with the player, and `standing` records why
 *    (`departed` unless the model says otherwise). The character is kept,
 *    forever.
 */
function applyParty(
  characters: Character[],
  roster: RosterEntry[],
  block: LoomBlock,
): { characters: Character[]; roster: RosterEntry[] } {
  if (!block.party?.length) return { characters, roster };
  let nextChars = characters;
  let nextRoster = roster;

  for (const d of block.party) {
    if (!d?.name) continue;
    const key = slug(d.name);
    const found = nextChars.find((c) => c.role === "member" && slug(c.name) === key);

    if (d.op === "remove") {
      if (found) nextRoster = setStanding(nextRoster, found.id, exitStanding(d));
      continue;
    }

    if (d.op === "update") {
      // Standing is all an update can say now: every sheet field it carries is
      // dropped on the floor, whatever the model wrote.
      if (!found || !d.standing) continue;
      nextRoster = setStanding(
        nextRoster,
        found.id,
        seatFor(d.standing, nextChars, nextRoster, found.id),
      );
      continue;
    }

    // add — seat a known character (sheet untouched), else write a new one.
    if (found) {
      // The dead stay dead as far as the narrator is concerned.
      if (standingOf(nextRoster, found.id) === "fallen") continue;
      nextRoster = setStanding(
        nextRoster,
        found.id,
        seatFor(d.standing ?? "active", nextChars, nextRoster, found.id),
      );
    } else {
      const created = makeCharacter(d, uniqueId(nextChars, `m-${key}`));
      nextChars = [...nextChars, created];
      nextRoster = setStanding(
        nextRoster,
        created.id,
        seatFor(d.standing ?? "active", nextChars, nextRoster, created.id),
      );
    }
  }

  return { characters: nextChars, roster: nextRoster };
}

/**
 * Conditions — the marks the story leaves on people (`stakes.ts`). Unlike party
 * ops these match the WHOLE library including the PC, because a COST outcome
 * lands on the player more often than on anyone else, and unlike sheet fields
 * they are not frozen: rewriting them every turn is the entire point.
 *
 * A blank condition clears the mark (`setCondition` deletes the key), and a
 * name nothing resolves is ignored rather than creating anybody — creation is
 * `applyParty`'s job alone.
 */
function applyConditions(
  characters: Character[],
  roster: RosterEntry[],
  block: LoomBlock,
): RosterEntry[] {
  if (!block.conditions?.length) return roster;
  let next = roster;

  for (const d of block.conditions) {
    if (!d?.name || typeof d.condition !== "string") continue;
    const key = slug(d.name);
    const found = characters.find((c) => slug(c.name) === key);
    if (!found) continue;
    next = setCondition(next, found.id, d.condition);
  }

  return next;
}

/** Standings a `remove` may leave someone in — never a party seat. */
function exitStanding(d: PartyDelta): Standing {
  const said = d.standing ?? d.status;
  if (said === "fallen" || said === "none" || said === "npc") return said;
  return "departed";
}

/**
 * Where the narrator's requested standing actually lands. Only the active
 * seats are capped; someone who would overflow the party joins the BENCH,
 * which is visible in the UI and named in the roll call, rather than the
 * nowhere-state the old `inParty: false, status: "active"` pair produced.
 */
function seatFor(
  standing: Standing,
  characters: Character[],
  roster: RosterEntry[],
  id: string,
): Standing {
  if (standing !== "active") return standing;
  if (standingOf(roster, id) === "active") return "active";
  return partyFull(characters, roster) ? "benched" : "active";
}

/**
 * Keep the name-derived id unique. A rename in the sheet can leave an old
 * `m-<slug>` id parked on a different character; a duplicate id would then
 * collide on the `portrait:<id>` cache key and on every id-keyed lookup.
 */
function uniqueId(characters: Character[], base: string): string {
  if (!characters.some((c) => c.id === base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!characters.some((c) => c.id === candidate)) return candidate;
  }
}

/**
 * A character the narrator just introduced. The id stays name-derived so a
 * portrait generated for "Riley" survives into any later adventure that
 * recruits Riley again.
 *
 * This is also the ONE moment gear is written from the story: the creating
 * `add` carries the equipment implied by the appearance it just wrote, so a
 * new companion arrives dressed instead of empty-handed. Every later op drops
 * `equipment` on the floor with the rest of the sheet — the kit is the
 * player's to curate from then on.
 */
function makeCharacter(d: PartyDelta, id: string): Character {
  return {
    id,
    role: "member",
    name: d.name,
    species: d.species ?? "",
    sex: d.sex ?? "",
    description: d.description ?? "",
    personality: d.personality ?? "",
    drive: d.drive ?? "",
    strengths: strengthsText(d.strengths),
    flaws: d.flaws ?? "",
    // Player notes are not the narrator's to seed either — `PartyDelta` has no
    // `notes` at all, so a character is born with an empty one and stays that
    // way until the player writes in it.
    notes: "",
    equipment: startingEquipment(d.equipment),
  };
}

/**
 * The delta's equipment, sanitized: labelless rows are dropped (nothing can
 * render or keyword-match them) and a missing description is blank, not
 * undefined. A non-array — the model wrote a string, or nothing — is no gear.
 *
 * A `quantity` is kept only when the model volunteered a sane one — the
 * narrator is never asked for counts, and a garbage value would ride onto the
 * sheet and into the pack the first time the player unequipped the row.
 */
function startingEquipment(equipment: PartyDelta["equipment"]): Equipment[] {
  if (!Array.isArray(equipment)) return [];
  return equipment
    .filter((e): e is Equipment => !!e && typeof e.label === "string" && !!e.label.trim())
    .map((e) => {
      const out: Equipment = {
        label: e.label,
        description: typeof e.description === "string" ? e.description : "",
      };
      const quantity = Math.floor(Number(e.quantity));
      if (Number.isFinite(quantity) && quantity > 1) out.quantity = quantity;
      return out;
    });
}

function applyInventory(current: Item[], block: LoomBlock): Item[] {
  if (!block.inventory?.length) return current;
  const next = current.slice();

  for (const d of block.inventory) {
    if (!d?.label) continue;
    const key = slug(d.label);
    const i = next.findIndex((it) => slug(it.label) === key);

    if (d.op === "remove") {
      // Gold is permanent — a remove empties the purse instead of deleting it.
      if (i !== -1) {
        if (isGold(next[i].label)) next[i] = { ...next[i], quantity: 0 };
        else next.splice(i, 1);
      }
      continue;
    }

    if (d.op === "update") {
      if (i !== -1) {
        next[i] = {
          ...next[i],
          description: d.description ?? next[i].description,
          quantity: d.quantity ?? next[i].quantity,
        };
      }
      continue;
    }

    // add — merge quantity if the item already exists, else push.
    const qty = d.quantity ?? 1;
    if (i !== -1) {
      next[i] = {
        ...next[i],
        quantity: next[i].quantity + qty,
        description: d.description ?? next[i].description,
      };
    } else {
      next.push({
        label: d.label,
        description: d.description ?? "",
        quantity: qty,
      });
    }
  }

  return next;
}

/**
 * World Notes the narrator wrote for itself, keyed by slugged title.
 *
 * This is the long-game memory: the history window is a fixed budget, so
 * everything not captured as a note, quest, item, or character is gone once it
 * scrolls out. A note survives, and `worldNotes.ts` gates it back in by keyword
 * for the rest of the adventure.
 *
 * Unlike quests, an `add` on an existing title UPDATES it rather than being a
 * no-op — the narrator learning more about a place it already noted is the
 * common case, and making it a silent no-op would quietly cap what the world
 * can remember about anything. `permanent` is deliberately not writable: an
 * always-injected note is a standing tax on every turn's budget, and that is
 * the player's call to make on the World Notes screen.
 */
function applyNotes(current: Note[], block: LoomBlock): Note[] {
  if (!block.notes?.length) return current;
  // Copy lazily: `captureReversal` reference-diffs this slice, so a block whose
  // note rows all turn out to be no-ops must hand back the SAME array or every
  // such turn records a pointless snapshot.
  let next = current;
  const own = () => (next === current ? (next = current.slice()) : next);

  for (const d of block.notes) {
    if (!d?.title) continue;
    const key = slug(d.title);
    const i = next.findIndex((n) => slug(n.title) === key);

    if (d.op === "remove") {
      if (i !== -1) own().splice(i, 1);
      continue;
    }

    const keywords = noteKeywords(d.keywords);
    if (i !== -1) {
      const cur = next[i];
      const content = d.content ?? cur.content;
      const merged = keywords ? mergeKeywords(cur.keywords, keywords) : cur.keywords;
      if (content === cur.content && merged === cur.keywords) continue;
      own()[i] = { ...cur, content, keywords: merged };
      continue;
    }

    own().push({
      id: `n-${key}-${next.length}`,
      title: d.title,
      keywords: keywords ?? [],
      content: d.content ?? "",
    });
  }

  return next;
}

/** A delta's keywords, sanitized. Returns undefined when the field was absent. */
function noteKeywords(keywords: NoteDelta["keywords"]): string[] | undefined {
  if (!Array.isArray(keywords)) return undefined;
  return keywords.filter((k): k is string => typeof k === "string" && !!k.trim());
}

/** Union of two keyword lists, case-insensitively de-duplicated, order kept. */
function mergeKeywords(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((k) => k.toLowerCase()));
  const added = incoming.filter((k) => !seen.has(k.toLowerCase()));
  return added.length ? [...existing, ...added] : existing;
}

function applyQuests(current: Quest[], block: LoomBlock): Quest[] {
  if (!block.quests?.length) return current;
  const next = current.slice();

  for (const d of block.quests) {
    if (!d?.label) continue;
    const key = slug(d.label);
    const i = next.findIndex((q) => slug(q.label) === key);

    if (d.op === "remove") {
      if (i !== -1) next.splice(i, 1);
      continue;
    }

    if (d.op === "update") {
      if (i !== -1) {
        next[i] = {
          ...next[i],
          description: d.description ?? next[i].description,
          reward: d.reward ?? next[i].reward,
          status: d.status ?? next[i].status,
        };
      }
      continue;
    }

    // add
    if (i === -1) {
      next.push({
        id: `q-${key}-${next.length}`,
        label: d.label,
        description: d.description ?? "",
        reward: d.reward ?? "",
        status: d.status ?? "active",
      });
    }
  }

  return next;
}
