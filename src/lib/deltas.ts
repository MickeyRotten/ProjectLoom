import type { Character, GameState, Item, LoomBlock, PartyDelta, Quest } from "../types";
import { isGold, PARTY_LIMIT } from "./defaults";

/**
 * Apply a parsed <<<LOOM>>> block to the active game (loom-turn-protocol):
 *  - location/day/weather OVERWRITE the scene.
 *  - party/inventory/quests are OP-BASED (add | update | remove), keyed by
 *    slugged name/label. Party members are Characters with role "member";
 *    `remove` benches (inParty=false) rather than deleting, so a rejoin or a
 *    portrait survives.
 *
 * Pure: returns the changed slices; callers merge into the store. Keeping this
 * pure is what makes the turn contract testable.
 */
export interface AppliedScene {
  day: number;
  location: string;
  weather: string;
  characters: Character[];
  inventory: Item[];
  quests: Quest[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function applyDeltas(game: GameState, block: LoomBlock): AppliedScene {
  const day = block.day ?? game.day;
  const location = block.location ?? game.location;
  const weather = block.weather ?? game.weather;

  return {
    day,
    location,
    weather,
    characters: applyParty(game.characters, block),
    inventory: applyInventory(game.inventory, block),
    quests: applyQuests(game.quests, block),
  };
}

/**
 * Op-based party roster, keyed by slugged member name. Only members
 * (role "member") are matched — the PC is never touched by a party delta.
 *  - add: create a new benched-in member, or re-enlist + refresh a known one.
 *    Enlisting respects PARTY_LIMIT — past the cap the member joins benched,
 *    matching the UI's enlist rule (the strip only has PARTY_LIMIT slots).
 *  - update: patch species/description/fieldSkill of a known member.
 *  - remove: bench the member (inParty=false); the record is kept.
 */
function applyParty(current: Character[], block: LoomBlock): Character[] {
  if (!block.party?.length) return current;
  const next = current.slice();
  const partyFull = () =>
    next.filter((c) => c.role === "member" && c.inParty).length >= PARTY_LIMIT;

  for (const d of block.party) {
    if (!d?.name) continue;
    const key = slug(d.name);
    const i = next.findIndex((c) => c.role === "member" && slug(c.name) === key);

    if (d.op === "remove") {
      if (i !== -1) next[i] = { ...next[i], inParty: false };
      continue;
    }

    if (d.op === "update") {
      if (i !== -1) next[i] = patchMember(next[i], d);
      continue;
    }

    // add — re-enlist + refresh an existing member, else create one.
    if (i !== -1) {
      next[i] = { ...patchMember(next[i], d), inParty: next[i].inParty || !partyFull() };
    } else {
      next.push({ ...makeMember(d, key), inParty: !partyFull() });
    }
  }

  return next;
}

function patchMember(c: Character, d: PartyDelta): Character {
  return {
    ...c,
    species: d.species ?? c.species,
    description: d.description ?? c.description,
    fieldSkill: d.fieldSkill ?? c.fieldSkill,
  };
}

function makeMember(d: PartyDelta, key: string): Character {
  return {
    id: `m-${key}`,
    role: "member",
    name: d.name,
    species: d.species ?? "",
    description: d.description ?? "",
    personality: "",
    drive: "",
    likes: "",
    dislikes: "",
    fieldSkill: d.fieldSkill ?? { name: "", description: "" },
    equipment: [],
    lastSpokeTurn: 0,
    inParty: true,
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
