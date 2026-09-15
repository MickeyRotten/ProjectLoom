import { describe, it, expect } from "vitest";
import {
  canEquip,
  equipItem,
  equipLine,
  equipQuantity,
  equipTargets,
  equippedAttributeBonus,
  heldSpecialisations,
  unequipItem,
} from "./equip";
import type { Block, Character, ItemBlock, Item, RosterEntry } from "../types";
import { fixedFieldBlocks } from "./testFixtures";

const item = (label: string, quantity = 1, description = ""): Item => ({
  label,
  description,
  quantity,
});

/** A stable-id Item block, so a test can address it by id without generating one. */
const itemBlock = (id: string, label: string, quantity = 1, description = ""): ItemBlock => ({
  id,
  type: "item",
  kind: "custom",
  title: label,
  text: description,
  quantity,
  enabled: true,
});

const character = (id: string, patch: Partial<Character> = {}): Character => ({
  id,
  role: "member",
  name: id,
  species: "",
  sex: "",
  blocks: fixedFieldBlocks(),
  ...patch,
});

const entry = (id: string, standing: RosterEntry["standing"]): RosterEntry => ({
  id,
  standing,
  lastSpokeTurn: 0,
});

describe("equipQuantity", () => {
  it("reads a missing count as one", () => {
    expect(equipQuantity({})).toBe(1);
  });

  it("floors and rejects nonsense", () => {
    expect(equipQuantity({ quantity: 3.7 })).toBe(3);
    expect(equipQuantity({ quantity: 0 })).toBe(1);
    expect(equipQuantity({ quantity: -2 })).toBe(1);
    expect(equipQuantity({ quantity: NaN })).toBe(1);
  });
});

describe("canEquip", () => {
  it("takes an ordinary item", () => {
    expect(canEquip(item("Rusty Key"))).toBe(true);
  });

  it("refuses Gold — the purse is the party's, in any casing", () => {
    expect(canEquip(item("Gold", 40))).toBe(false);
    expect(canEquip(item(" gold ", 40))).toBe(false);
    // Not the currency, just gilded.
    expect(canEquip(item("Golden Idol"))).toBe(true);
  });

  it("refuses a blank label or an empty row", () => {
    expect(canEquip(item("  "))).toBe(false);
    expect(canEquip(item("Torch", 0))).toBe(false);
  });
});

describe("equipItem — pack → kit", () => {
  it("moves the whole row, count and all, as a new Item block", () => {
    const inventory = [item("Gold", 10), item("Arrow", 12, "Fletched with crow.")];
    const move = equipItem(inventory, [], 1);
    expect(move).not.toBeNull();
    expect(move!.inventory).toEqual([item("Gold", 10)]);
    expect(move!.blocks).toHaveLength(1);
    expect(move!.blocks[0]).toMatchObject({
      type: "item",
      title: "Arrow",
      text: "Fletched with crow.",
      quantity: 12,
      enabled: true,
    });
  });

  it("never leaves the item in both places", () => {
    const inventory = [item("Sword")];
    const move = equipItem(inventory, [], 0)!;
    expect(move.inventory.some((it) => it.label === "Sword")).toBe(false);
    expect(move.blocks.some((b) => b.type === "item" && b.title === "Sword")).toBe(true);
  });

  it("merges into an existing kit row instead of listing it twice", () => {
    const existing = itemBlock("b1", "arrow", 12, "Fletched.");
    const move = equipItem([item("Arrow", 3)], [existing], 0)!;
    expect(move.blocks).toHaveLength(1);
    expect(move.blocks[0]).toMatchObject({
      id: "b1",
      title: "arrow",
      text: "Fletched.",
      quantity: 15,
    });
  });

  it("merges a kit row with no stored count as one", () => {
    const existing = itemBlock("b1", "Torch", 1);
    const move = equipItem([item("Torch", 2)], [existing], 0)!;
    expect((move.blocks[0] as ItemBlock).quantity).toBe(3);
  });

  it("fills a blank kit description from the pack, never overwrites one", () => {
    const filled = equipItem([item("Rope", 1, "Fifty feet.")], [itemBlock("b1", "Rope", 1, "")], 0)!;
    expect((filled.blocks[0] as ItemBlock).text).toBe("Fifty feet.");

    const kept = equipItem(
      [item("Rope", 1, "Fifty feet.")],
      [itemBlock("b1", "Rope", 1, "Hers.")],
      0,
    )!;
    expect((kept.blocks[0] as ItemBlock).text).toBe("Hers.");
  });

  it("leaves other kit blocks alone, appending the new one at the end", () => {
    const move = equipItem(
      [item("Arrow")],
      [itemBlock("b1", "Bow"), itemBlock("b2", "Knife")],
      0,
    )!;
    expect(move.blocks.map((b) => b.title)).toEqual(["Bow", "Knife", "Arrow"]);
  });

  it("returns null — writing nothing — for Gold, a blank row, or a bad index", () => {
    expect(equipItem([item("Gold", 10)], [], 0)).toBeNull();
    expect(equipItem([item("  ")], [], 0)).toBeNull();
    expect(equipItem([item("Torch", 0)], [], 0)).toBeNull();
    expect(equipItem([item("Torch")], [], 4)).toBeNull();
    expect(equipItem([], [], -1)).toBeNull();
  });

  it("mutates neither array it was handed", () => {
    const inventory = [item("Sword")];
    const blocks: Block[] = [itemBlock("b1", "Shield")];
    equipItem(inventory, blocks, 0);
    expect(inventory).toEqual([item("Sword")]);
    expect(blocks).toEqual([itemBlock("b1", "Shield")]);
  });
});

describe("unequipItem — kit → pack", () => {
  it("moves the whole block back, addressed by id", () => {
    const move = unequipItem([], [itemBlock("b1", "Arrow", 12, "Fletched.")], "b1")!;
    expect(move.blocks).toEqual([]);
    expect(move.inventory).toEqual([item("Arrow", 12, "Fletched.")]);
  });

  it("merges into an existing pack row", () => {
    const move = unequipItem(
      [item("Gold", 10), item("arrow", 3)],
      [itemBlock("b1", "Arrow", 12)],
      "b1",
    )!;
    expect(move.inventory).toEqual([item("Gold", 10), item("arrow", 15)]);
  });

  it("leaves other blocks alone", () => {
    const move = unequipItem(
      [],
      [itemBlock("b1", "Bow"), itemBlock("b2", "Torch")],
      "b2",
    )!;
    expect(move.blocks.map((b) => b.title)).toEqual(["Bow"]);
  });

  it("returns null for a blank label or an unknown id", () => {
    expect(unequipItem([], [itemBlock("b1", "  ")], "b1")).toBeNull();
    expect(unequipItem([], [itemBlock("b1", "Sword")], "nope")).toBeNull();
  });

  it("round-trips exactly — equip then unequip restores the pack", () => {
    const inventory = [item("Gold", 10), item("Arrow", 12, "Fletched.")];
    const there = equipItem(inventory, [itemBlock("bow", "Bow")], 1)!;
    const addedId = there.blocks.find((b) => b.title === "Arrow")!.id;
    const back = unequipItem(there.inventory, there.blocks, addedId)!;
    expect(back.inventory).toEqual(inventory);
    expect(back.blocks).toEqual([itemBlock("bow", "Bow")]);
  });

  it("conserves the count across a merge round-trip", () => {
    const there = equipItem([item("Arrow", 3)], [itemBlock("b1", "Arrow", 12)], 0)!;
    const back = unequipItem(there.inventory, there.blocks, "b1")!;
    expect(back.inventory).toEqual([item("Arrow", 15)]);
    expect(back.blocks).toEqual([]);
  });
});

describe("equipTargets", () => {
  const characters = [
    character("pc", { role: "pc", name: "You" }),
    character("a", { name: "Active" }),
    character("b", { name: "Benched" }),
    character("n", { name: "Ally" }),
    character("d", { name: "Departed" }),
    character("x", { name: "Uninvolved" }),
  ];
  const roster = [
    entry("a", "active"),
    entry("b", "benched"),
    entry("n", "npc"),
    entry("d", "departed"),
  ];

  it("is the PC then the company — active and benched, nobody else", () => {
    expect(equipTargets(characters, roster).map((m) => m.id)).toEqual(["pc", "a", "b"]);
  });

  it("still works with no PC in the library", () => {
    expect(equipTargets(characters.slice(1), roster).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("RPG System mechanics on equipped gear", () => {
  it("sums an Attribute bonus across equipped items, capped at MAX_ATTRIBUTE", () => {
    const blocks: Block[] = [
      { ...itemBlock("b1", "Ring", 1), attributeBonus: { attribute: "might", amount: 2 } },
      { ...itemBlock("b2", "Belt", 1), attributeBonus: { attribute: "might", amount: 2 } },
      { ...itemBlock("b3", "Cloak", 1), attributeBonus: { attribute: "agility", amount: 1 } },
    ];
    expect(equippedAttributeBonus(blocks, "might")).toBe(3); // capped, not 4
    expect(equippedAttributeBonus(blocks, "agility")).toBe(1);
    expect(equippedAttributeBonus(blocks, "mind")).toBe(0);
  });

  it("ignores a disabled item's bonus", () => {
    const blocks: Block[] = [
      { ...itemBlock("b1", "Ring", 1), attributeBonus: { attribute: "might", amount: 2 }, enabled: false },
    ];
    expect(equippedAttributeBonus(blocks, "might")).toBe(0);
  });

  it("unions the character's own picks with what their gear grants, de-duplicated", () => {
    const blocks: Block[] = [
      { ...itemBlock("b1", "Ring", 1), grantedSpecialisation: "athletics" },
      { ...itemBlock("b2", "Belt", 1), grantedSpecialisation: "lore" },
    ];
    expect(heldSpecialisations({ specialisations: ["athletics", "stealth"], blocks })).toEqual([
      "athletics",
      "stealth",
      "lore",
    ]);
  });

  it("carries the mechanics through an equip/unequip round-trip", () => {
    const gearedItem = { ...item("Ring"), attributeBonus: { attribute: "might" as const, amount: 2 }, grantedSpecialisation: "athletics" };
    const equipped = equipItem([gearedItem], [], 0)!;
    const block = equipped.blocks[0] as ItemBlock;
    expect(block.attributeBonus).toEqual({ attribute: "might", amount: 2 });
    expect(block.grantedSpecialisation).toBe("athletics");

    const back = unequipItem(equipped.inventory, equipped.blocks, block.id)!;
    expect(back.inventory[0].attributeBonus).toEqual({ attribute: "might", amount: 2 });
    expect(back.inventory[0].grantedSpecialisation).toBe("athletics");
  });
});

describe("equipLine", () => {
  it("drops the count at one and the description at blank", () => {
    expect(equipLine({ label: "Sword", description: "" })).toBe("Sword");
    expect(equipLine({ label: "Sword", description: "Chipped." })).toBe("Sword: Chipped.");
    expect(equipLine({ label: "Arrow", description: "", quantity: 12 })).toBe("Arrow ×12");
    expect(equipLine({ label: "Arrow", description: "Fletched.", quantity: 12 })).toBe(
      "Arrow ×12: Fletched.",
    );
  });
});
