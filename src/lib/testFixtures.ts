import type { Block, Equipment, ItemBlock, TextBlock } from "../types";
import { buildDefaultBlocks, type DefaultBlockFields } from "./defaults";
import { firstBlockText, makeItemBlock } from "./blocks";

/**
 * Test-only helper: build a block list from the old fixed-field shape
 * (`description`/`personality`/`drive`/`strengths`/`flaws`/`notes`/
 * `equipment`), so test fixtures across the suite can keep constructing
 * characters the way they did before the block refactor without every test
 * file re-deriving the same six-block + item-block wiring.
 */
export function fixedFieldBlocks(
  fields: DefaultBlockFields & { equipment?: Equipment[] } = {},
): Block[] {
  const { equipment, ...text } = fields;
  return [
    ...buildDefaultBlocks(text),
    ...(equipment ?? []).map((e) => makeItemBlock(e.label, e.description, e.quantity ?? 1)),
  ];
}

/** Read a fixed field back off a block list, for assertions. */
export function blockText(blocks: Block[], kind: TextBlock["kind"]): string {
  return firstBlockText(blocks, kind);
}

/**
 * Every enabled Item block, as the old `Equipment[]` shape — for assertions.
 * `quantity` is dropped at one, matching `Equipment.quantity?`'s old
 * absent-means-one convention.
 */
export function blockEquipment(blocks: Block[]): Equipment[] {
  return blocks
    .filter((b): b is ItemBlock => b.type === "item")
    .map((b) => ({
      label: b.title,
      description: b.text,
      ...(b.quantity > 1 ? { quantity: b.quantity } : {}),
    }));
}
