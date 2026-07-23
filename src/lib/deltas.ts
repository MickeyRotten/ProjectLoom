import type { GameState, Item, LoomBlock, Quest } from "../types";

/**
 * Apply a parsed <<<LOOM>>> block to the active game (loom-turn-protocol):
 *  - location/day/weather OVERWRITE the scene.
 *  - inventory/quests are OP-BASED (add | update | remove), keyed by label.
 *  - party is deferred to Phase 2 (needs Character + spotlight wiring).
 *
 * Pure: returns the changed slices; callers merge into the store. Keeping this
 * pure is what makes the turn contract testable.
 */
export interface AppliedScene {
  day: number;
  location: string;
  weather: string;
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
    inventory: applyInventory(game.inventory, block),
    quests: applyQuests(game.quests, block),
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
      if (i !== -1) next.splice(i, 1);
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
