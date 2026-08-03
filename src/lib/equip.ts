import type { Character, Equipment, Item, PartyMember, RosterEntry } from "../types";
import { isGold } from "./defaults";
import { slug } from "./deltas";
import { partyMembers, playerCharacter } from "./roster";

/**
 * Moving gear between the shared pack and a character's kit.
 *
 * The two halves of "what you have" were sealed off from each other: the
 * INVENTORY is the party's shared pack (`GameState.inventory`, per-adventure)
 * and EQUIPMENT is what one character wears or carries (`Character.equipment`,
 * with the cast). Both were editable, neither could reach the other, so
 * handing the sword the party just looted to the swordswoman meant deleting a
 * row here and retyping it there — and typing it in both places is how an item
 * ends up existing twice.
 *
 * So this is a MOVE, never a copy: an item is in the pack or on a person, never
 * in both. Every function here returns fresh arrays for BOTH sides of the move,
 * and the store writes them together — the pack lives on the game, the kit on
 * the character, and half a move applied is a duplicated or vanished item.
 *
 * Whole rows move. Equipment carries the count with it (`Equipment.quantity`),
 * so twelve arrows are still twelve after they change hands, and the move is
 * exactly reversible — which is what makes an accidental equip a one-tap fix
 * instead of an arithmetic exercise.
 */

/** How many of an equipped item there are. Absent — every record written before
 *  gear could be moved, and every narrator-authored kit — reads as one. */
export function equipQuantity(e: Pick<Equipment, "quantity">): number {
  const q = Math.floor(e.quantity ?? 1);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

/**
 * Can this pack row be handed to someone? A blank label names nothing, a row
 * with nothing left in it has nothing to give, and Gold is the permanent purse
 * — the currency row is the one thing every game keeps, and equipping it would
 * take the party's money off the party.
 */
export function canEquip(item: Item): boolean {
  return !!item && !!item.label.trim() && !isGold(item.label) && item.quantity >= 1;
}

/**
 * Who can be handed something: the PC first, then the company — active and
 * benched alike, since a benched companion is still one of yours and stowing
 * gear on them is half the point of a bench. NPCs are not: their kit is the
 * world's, not the player's.
 */
export function equipTargets(
  characters: Character[],
  roster: RosterEntry[],
): PartyMember[] {
  const pc = playerCharacter(characters, roster);
  const party = partyMembers(characters, roster);
  return pc ? [pc, ...party] : party;
}

/** Both sides of a completed move — write them together or not at all. */
export interface Move {
  inventory: Item[];
  equipment: Equipment[];
}

/**
 * Pack row → character's kit. The whole row moves, count and all; a kit row
 * with the same label absorbs it rather than sitting beside it, so equipping
 * three arrows twice reads as ×6 and not as two rows called Arrow.
 *
 * Returns null when there is nothing to move (see `canEquip`), so the caller
 * writes nothing at all.
 */
export function equipItem(
  inventory: Item[],
  equipment: Equipment[],
  index: number,
): Move | null {
  const item = inventory[index];
  if (!item || !canEquip(item)) return null;

  const quantity = Math.floor(item.quantity);
  const key = slug(item.label);
  const at = equipment.findIndex((e) => slug(e.label) === key);
  const next = equipment.slice();

  if (at === -1) {
    next.push({ label: item.label, description: item.description, quantity });
  } else {
    next[at] = {
      ...next[at],
      // The kit's own wording wins — a player who rewrote a description on the
      // sheet should not have it replaced by the pack's copy on a top-up.
      description: next[at].description || item.description,
      quantity: equipQuantity(next[at]) + quantity,
    };
  }

  return { inventory: inventory.filter((_, i) => i !== index), equipment: next };
}

/**
 * Character's kit → pack. The mirror of `equipItem`: the whole row comes back,
 * merging into a pack row of the same label if one is there.
 *
 * Returns null when the row names nothing.
 */
export function unequipItem(
  inventory: Item[],
  equipment: Equipment[],
  index: number,
): Move | null {
  const e = equipment[index];
  if (!e || !e.label.trim()) return null;

  const quantity = equipQuantity(e);
  const key = slug(e.label);
  const at = inventory.findIndex((it) => slug(it.label) === key);
  const next = inventory.slice();

  if (at === -1) {
    next.push({ label: e.label, description: e.description, quantity });
  } else {
    next[at] = {
      ...next[at],
      description: next[at].description || e.description,
      quantity: next[at].quantity + quantity,
    };
  }

  return { inventory: next, equipment: equipment.filter((_, i) => i !== index) };
}

/**
 * One equipped item as a line of prompt text — `Label ×3: description`, with
 * the count dropping out at one and the description at blank. Every place the
 * model is shown someone's kit goes through this, so a count the player moved
 * can't be visible on the sheet and invisible to the narrator.
 */
export function equipLine(e: Equipment): string {
  const quantity = equipQuantity(e);
  const count = quantity > 1 ? ` ×${quantity}` : "";
  return `${e.label}${count}${e.description ? `: ${e.description}` : ""}`;
}
