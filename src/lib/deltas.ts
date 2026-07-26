import type {
  Character,
  Equipment,
  GameState,
  Item,
  LoomBlock,
  Note,
  NoteDelta,
  PartyDelta,
  Quest,
  RosterEntry,
  Standing,
} from "../types";
import { isGold } from "./defaults";
import { partyFull, setCondition, setStanding, standingOf, strengthsText } from "./roster";

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

const slug = (s: string) =>
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
    equipment: startingEquipment(d.equipment),
  };
}

/**
 * The delta's equipment, sanitized: labelless rows are dropped (nothing can
 * render or keyword-match them) and a missing description is blank, not
 * undefined. A non-array — the model wrote a string, or nothing — is no gear.
 */
function startingEquipment(equipment: PartyDelta["equipment"]): Equipment[] {
  if (!Array.isArray(equipment)) return [];
  return equipment
    .filter((e): e is Equipment => !!e && typeof e.label === "string" && !!e.label.trim())
    .map((e) => ({
      label: e.label,
      description: typeof e.description === "string" ? e.description : "",
    }));
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
