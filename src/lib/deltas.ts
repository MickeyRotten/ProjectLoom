import type {
  Character,
  CharacterOverride,
  GameState,
  Item,
  LoomBlock,
  PartyDelta,
  Quest,
  RosterEntry,
} from "../types";
import { isGold } from "./defaults";
import { getEntry, mergeOverrides, partyFull, setEntry } from "./roster";

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
 *  - membership / status / last-spoke → this adventure's roster;
 *  - field changes on a KNOWN character → that adventure's overrides, so the
 *    player's authored text is never overwritten by the story;
 *  - a brand-new character → the library, since there is no base to diverge
 *    from yet.
 * `remove` only un-parties (and records why); nothing the model emits ever
 * deletes a character.
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
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function applyDeltas(
  game: GameState,
  characters: Character[],
  block: LoomBlock,
): AppliedScene {
  const day = block.day ?? game.day;
  const location = block.location ?? game.location;
  const weather = block.weather ?? game.weather;
  const party = applyParty(characters, game.roster, block);

  return {
    day,
    location,
    weather,
    characters: party.characters,
    roster: party.roster,
    inventory: applyInventory(game.inventory, block),
    quests: applyQuests(game.quests, block),
  };
}

/**
 * Op-based party membership, keyed by slugged character name across the whole
 * library. Only members (role "member") are matched — the PC is never touched
 * by a party delta.
 *  - add: enlist a known character (refreshing fields as overrides), or create
 *    one in the library. Enlisting respects PARTY_LIMIT — past the cap the
 *    character joins the adventure out of the party, matching the UI's rule
 *    (the strip only has PARTY_LIMIT slots). A `fallen` character is never
 *    re-recruited by the narrator; only the player can bring them back.
 *  - update: override species/description/personality/drive/strengths for this
 *    adventure. Never creates.
 *  - remove: un-party and record why (`departed` unless the model says
 *    otherwise). The character itself is kept, forever.
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
      if (found) {
        nextRoster = setEntry(nextRoster, found.id, {
          inParty: false,
          status: d.status ?? "departed",
        });
      }
      continue;
    }

    if (d.op === "update") {
      if (found) nextRoster = mergeOverrides(nextRoster, found.id, overridesOf(d));
      continue;
    }

    // add — enlist + refresh a known character, else write a new one.
    if (found) {
      const entry = getEntry(nextRoster, found.id);
      // The dead stay dead as far as the narrator is concerned.
      if (entry.status === "fallen") continue;
      nextRoster = mergeOverrides(nextRoster, found.id, overridesOf(d));
      nextRoster = setEntry(nextRoster, found.id, {
        status: "active",
        inParty: entry.inParty || !partyFull(nextRoster),
      });
    } else {
      const created = makeCharacter(d, uniqueId(nextChars, `m-${key}`));
      nextChars = [...nextChars, created];
      nextRoster = setEntry(nextRoster, created.id, { inParty: !partyFull(nextRoster) });
    }
  }

  return { characters: nextChars, roster: nextRoster };
}

/** The subset of a party delta that can diverge from the base character. */
function overridesOf(d: PartyDelta): CharacterOverride {
  const o: CharacterOverride = {};
  if (d.species !== undefined) o.species = d.species;
  if (d.description !== undefined) o.description = d.description;
  if (d.personality !== undefined) o.personality = d.personality;
  if (d.drive !== undefined) o.drive = d.drive;
  if (d.strengths !== undefined) o.strengths = d.strengths;
  return o;
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
 */
function makeCharacter(d: PartyDelta, id: string): Character {
  return {
    id,
    role: "member",
    name: d.name,
    species: d.species ?? "",
    description: d.description ?? "",
    personality: d.personality ?? "",
    drive: d.drive ?? "",
    strengths: d.strengths ?? { name: "", description: "" },
    equipment: [],
  };
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
