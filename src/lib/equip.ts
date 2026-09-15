import type { Attribute, Block, Character, Item, ItemBlock, PartyMember, RosterEntry } from "../types";
import { MAX_ATTRIBUTE } from "./attributes";
import { isGold } from "./defaults";
import { slug } from "./deltas";
import { makeItemBlock } from "./blocks";
import { partyMembers, playerCharacter } from "./roster";

/**
 * Moving gear between the shared pack and a character's kit.
 *
 * The two halves of "what you have" were sealed off from each other: the
 * INVENTORY is the party's shared pack (`GameState.inventory`, per-adventure)
 * and EQUIPMENT is what one character wears or carries — now an Item block
 * among `Character.blocks`. Both were editable, neither could reach the
 * other, so handing the sword the party just looted to the swordswoman meant
 * deleting a row here and retyping it there — and typing it in both places is
 * how an item ends up existing twice.
 *
 * So this is a MOVE, never a copy: an item is in the pack or on a person, never
 * in both. Every function here returns fresh arrays for BOTH sides of the move,
 * and the store writes them together — the pack lives on the game, the kit on
 * the character, and half a move applied is a duplicated or vanished item.
 *
 * Whole rows move. An Item block carries its own count (`ItemBlock.quantity`),
 * so twelve arrows are still twelve after they change hands, and the move is
 * exactly reversible — which is what makes an accidental equip a one-tap fix
 * instead of an arithmetic exercise.
 */

/**
 * How many of a quantity-optional row there are — `Equipment`, `ItemRow`, the
 * narrator's `PartyDelta.equipment`. Absent (every record written before gear
 * could move, and every narrator-authored kit) reads as one; an Item block's
 * own `quantity` is never optional, so this is for everything upstream of one.
 */
export function equipQuantity(e: { quantity?: number }): number {
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
  blocks: Block[];
}

/**
 * Pack row → character's blocks, as a new (or merged) Item block. An
 * existing Item block with the same label absorbs it rather than sitting
 * beside it, so equipping three arrows twice reads as ×6 and not as two
 * blocks called Arrow. A fresh block lands at the END of the list.
 *
 * Returns null when there is nothing to move (see `canEquip`), so the caller
 * writes nothing at all.
 */
export function equipItem(
  inventory: Item[],
  blocks: Block[],
  index: number,
): Move | null {
  const item = inventory[index];
  if (!item || !canEquip(item)) return null;

  const quantity = Math.floor(item.quantity);
  const key = slug(item.label);
  const at = blocks.findIndex((b) => b.type === "item" && slug(b.title) === key);
  let next: Block[];

  if (at === -1) {
    next = [
      ...blocks,
      makeItemBlock(item.label, item.description, quantity, item.attributeBonus, item.grantedSpecialisation),
    ];
  } else {
    const existing = blocks[at] as ItemBlock;
    next = blocks.slice();
    next[at] = {
      ...existing,
      // The kit's own wording wins — a player who rewrote a description on the
      // sheet should not have it replaced by the pack's copy on a top-up.
      text: existing.text || item.description,
      quantity: existing.quantity + quantity,
      attributeBonus: existing.attributeBonus ?? item.attributeBonus,
      grantedSpecialisation: existing.grantedSpecialisation ?? item.grantedSpecialisation,
    };
  }

  return { inventory: inventory.filter((_, i) => i !== index), blocks: next };
}

/**
 * Character's Item block → pack. The mirror of `equipItem`: the whole block
 * comes back, merging into a pack row of the same label if one is there.
 * Addressed by block id, not position — blocks are player-reorderable, so an
 * index can go stale between a render and a tap.
 *
 * Returns null when the id names no Item block, or one with a blank label.
 */
export function unequipItem(
  inventory: Item[],
  blocks: Block[],
  blockId: string,
): Move | null {
  const at = blocks.findIndex((b) => b.id === blockId && b.type === "item");
  if (at === -1) return null;
  const b = blocks[at] as ItemBlock;
  if (!b.title.trim()) return null;

  const quantity = b.quantity;
  const key = slug(b.title);
  const atInv = inventory.findIndex((it) => slug(it.label) === key);
  const next = inventory.slice();

  if (atInv === -1) {
    next.push({
      label: b.title,
      description: b.text,
      quantity,
      attributeBonus: b.attributeBonus,
      grantedSpecialisation: b.grantedSpecialisation,
    });
  } else {
    next[atInv] = {
      ...next[atInv],
      description: next[atInv].description || b.text,
      quantity: next[atInv].quantity + quantity,
      attributeBonus: next[atInv].attributeBonus ?? b.attributeBonus,
      grantedSpecialisation: next[atInv].grantedSpecialisation ?? b.grantedSpecialisation,
    };
  }

  return { inventory: next, blocks: blocks.filter((_, i) => i !== at) };
}

/**
 * One equipped or packed item as a line of prompt text — `Label ×3:
 * description`, with the count dropping out at one and the description at
 * blank. Takes the generic `{label, description, quantity?}` shape shared by
 * `Equipment`/`Item`/`ItemRow`, so the shared pack's formatting
 * (`generateItem.ts → formatPackBlock`) and an Item block's rendering
 * (`blocks.ts → renderBlocks`) read the same line the same way.
 */
export function equipLine(e: { label: string; description: string; quantity?: number }): string {
  const quantity = equipQuantity(e);
  const count = quantity > 1 ? ` ×${quantity}` : "";
  return `${e.label}${count}${e.description ? `: ${e.description}` : ""}`;
}

/**
 * RPG System mechanics riding on equipped gear (RPG_DESIGN.md → Equipment).
 * Both fields are purely mechanical and purely player-set — never
 * model-authored, the same precedent `canEquip` already sets by refusing
 * Gold.
 */

/**
 * Total Attribute bonus from every equipped Item block for one Attribute,
 * capped at the same ±`MAX_ATTRIBUTE` range Attributes themselves use — five
 * rings of Might is not free +5. Read at roll time, not stored, so editing an
 * equipped item's bonus takes effect on the next check without a migration.
 */
export function equippedAttributeBonus(blocks: Block[], attribute: Attribute): number {
  const total = blocks.reduce((sum, b) => {
    if (b.type !== "item" || !b.enabled) return sum;
    const bonus = b.attributeBonus;
    if (!bonus || bonus.attribute !== attribute) return sum;
    return sum + Math.max(0, bonus.amount);
  }, 0);
  return Math.min(MAX_ATTRIBUTE, total);
}

/**
 * A character's held Specialisation ids — their own picked set, plus any
 * granted by currently-equipped gear. Union, de-duplicated: wearing two items
 * that grant the same specialisation is no better than wearing one.
 */
export function heldSpecialisations(character: Pick<Character, "specialisations" | "blocks">): string[] {
  const own = Array.isArray(character.specialisations) ? character.specialisations : [];
  const granted = character.blocks
    .filter((b): b is ItemBlock => b.type === "item" && b.enabled && !!b.grantedSpecialisation)
    .map((b) => b.grantedSpecialisation as string);
  return [...new Set([...own, ...granted])];
}
