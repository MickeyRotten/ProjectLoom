import { describe, it, expect } from "vitest";
import {
  canEquip,
  equipItem,
  equipLine,
  equipQuantity,
  equipTargets,
  unequipItem,
} from "./equip";
import type { Character, Equipment, Item, RosterEntry } from "../types";

const item = (label: string, quantity = 1, description = ""): Item => ({
  label,
  description,
  quantity,
});

const gear = (label: string, quantity?: number, description = ""): Equipment =>
  quantity === undefined ? { label, description } : { label, description, quantity };

const character = (id: string, patch: Partial<Character> = {}): Character => ({
  id,
  role: "member",
  name: id,
  species: "",
  sex: "",
  description: "",
  personality: "",
  drive: "",
  strengths: "",
  flaws: "",
  notes: "",
  equipment: [],
  ...patch,
});

const entry = (id: string, standing: RosterEntry["standing"]): RosterEntry => ({
  id,
  standing,
  lastSpokeTurn: 0,
});

describe("equipQuantity", () => {
  it("reads a missing count as one", () => {
    expect(equipQuantity(gear("Sword"))).toBe(1);
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
  it("moves the whole row, count and all", () => {
    const inventory = [item("Gold", 10), item("Arrow", 12, "Fletched with crow.")];
    const move = equipItem(inventory, [], 1);
    expect(move).not.toBeNull();
    expect(move!.inventory).toEqual([item("Gold", 10)]);
    expect(move!.equipment).toEqual([
      { label: "Arrow", description: "Fletched with crow.", quantity: 12 },
    ]);
  });

  it("never leaves the item in both places", () => {
    const inventory = [item("Sword")];
    const move = equipItem(inventory, [], 0)!;
    expect(move.inventory.some((it) => it.label === "Sword")).toBe(false);
    expect(move.equipment.some((e) => e.label === "Sword")).toBe(true);
  });

  it("merges into an existing kit row instead of listing it twice", () => {
    const move = equipItem([item("Arrow", 3)], [gear("arrow", 12, "Fletched.")], 0)!;
    expect(move.equipment).toHaveLength(1);
    expect(move.equipment[0]).toEqual({
      label: "arrow",
      description: "Fletched.",
      quantity: 15,
    });
  });

  it("merges a kit row with no stored count as one", () => {
    const move = equipItem([item("Torch", 2)], [gear("Torch")], 0)!;
    expect(move.equipment[0].quantity).toBe(3);
  });

  it("fills a blank kit description from the pack, never overwrites one", () => {
    const filled = equipItem([item("Rope", 1, "Fifty feet.")], [gear("Rope", 1, "")], 0)!;
    expect(filled.equipment[0].description).toBe("Fifty feet.");

    const kept = equipItem([item("Rope", 1, "Fifty feet.")], [gear("Rope", 1, "Hers.")], 0)!;
    expect(kept.equipment[0].description).toBe("Hers.");
  });

  it("leaves other kit rows alone", () => {
    const move = equipItem([item("Arrow")], [gear("Bow"), gear("Knife")], 0)!;
    expect(move.equipment.map((e) => e.label)).toEqual(["Bow", "Knife", "Arrow"]);
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
    const equipment = [gear("Shield")];
    equipItem(inventory, equipment, 0);
    expect(inventory).toEqual([item("Sword")]);
    expect(equipment).toEqual([gear("Shield")]);
  });
});

describe("unequipItem — kit → pack", () => {
  it("moves the whole row back", () => {
    const move = unequipItem([], [gear("Arrow", 12, "Fletched.")], 0)!;
    expect(move.equipment).toEqual([]);
    expect(move.inventory).toEqual([item("Arrow", 12, "Fletched.")]);
  });

  it("merges into an existing pack row", () => {
    const move = unequipItem([item("Gold", 10), item("arrow", 3)], [gear("Arrow", 12)], 0)!;
    expect(move.inventory).toEqual([item("Gold", 10), item("arrow", 15)]);
  });

  it("counts a kit row with no stored count as one", () => {
    const move = unequipItem([], [gear("Torch")], 0)!;
    expect(move.inventory[0].quantity).toBe(1);
  });

  it("returns null for a blank label or a bad index", () => {
    expect(unequipItem([], [gear("  ")], 0)).toBeNull();
    expect(unequipItem([], [gear("Sword")], 2)).toBeNull();
  });

  it("round-trips exactly — equip then unequip restores the pack", () => {
    const inventory = [item("Gold", 10), item("Arrow", 12, "Fletched.")];
    const there = equipItem(inventory, [gear("Bow")], 1)!;
    const back = unequipItem(there.inventory, there.equipment, 1)!;
    expect(back.inventory).toEqual(inventory);
    expect(back.equipment).toEqual([gear("Bow")]);
  });

  it("conserves the count across a merge round-trip", () => {
    const there = equipItem([item("Arrow", 3)], [gear("Arrow", 12)], 0)!;
    const back = unequipItem(there.inventory, there.equipment, 0)!;
    expect(back.inventory).toEqual([item("Arrow", 15)]);
    expect(back.equipment).toEqual([]);
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

describe("equipLine", () => {
  it("drops the count at one and the description at blank", () => {
    expect(equipLine(gear("Sword"))).toBe("Sword");
    expect(equipLine(gear("Sword", 1, "Chipped."))).toBe("Sword: Chipped.");
    expect(equipLine(gear("Arrow", 12))).toBe("Arrow ×12");
    expect(equipLine(gear("Arrow", 12, "Fletched."))).toBe("Arrow ×12: Fletched.");
  });
});
