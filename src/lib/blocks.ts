import type { Attribute, Block, BlockKind, ItemBlock, TextBlock } from "../types";

/**
 * The character-sheet block system (loom-turn-protocol's sibling for the
 * cast): a character's body is an ordered, player-editable list of `Block`s
 * — Text or Item — each independently enabled/disabled. This module is the
 * ONE place that turns that list into prompt text, so the PC block, the
 * party roster, the NPC block and every side-call sheet stay one view of the
 * same renderer instead of drifting copies (the same reason `roster.ts →
 * formatIdentity`/`formatTraits` existed before blocks did).
 */

/** First ENABLED text block of this kind, in list order — "" if none. */
function matchKind(blocks: Block[], kind: BlockKind): TextBlock | undefined {
  return blocks.find(
    (b): b is TextBlock => b.type === "text" && b.kind === kind && b.enabled,
  );
}

/**
 * The text mechanics read by kind — dice modifier/spotlight source off
 * `"strengths"`/`"flaws"`, portrait Subject off `"appearance"`, Auto-Update's
 * read side. A disabled block of the matching kind reads the same as none:
 * turning a block off removes it from the mechanic it feeds, not just the
 * prompt.
 */
export function firstBlockText(blocks: Block[], kind: BlockKind): string {
  return matchKind(blocks, kind)?.text ?? "";
}

/** The id of that same block — Auto-Update's and ✦-generate's write target. */
export function firstBlockId(blocks: Block[], kind: BlockKind): string | undefined {
  return matchKind(blocks, kind)?.id;
}

/**
 * One line per ENABLED, non-blank block, in list order — `"Title: text"` for
 * a Text block, `"Title ×n: text"` for an Item block (count only shown above
 * one). A block with nothing to say (blank text, or a blank label on an Item
 * block) is skipped entirely, exactly like a blank fixed field used to drop
 * out of `formatTraits`.
 */
export function renderBlocks(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (!b.enabled) continue;
    if (b.type === "text") {
      if (!b.text.trim()) continue;
      out.push(`${b.title}: ${b.text}`);
    } else {
      if (!b.title.trim()) continue;
      const count = b.quantity > 1 ? ` ×${b.quantity}` : "";
      out.push(`${b.title}${count}${b.text ? `: ${b.text}` : ""}`);
    }
  }
  return out;
}

/**
 * A character's whole rendered sheet, wrapped in an open/close tag keyed by
 * `id` (stable across rename, punctuation-free) so it can't bleed into
 * another character's blocks or the surrounding prompt — the same structural
 * bracket vocabulary as `<<<LOOM>>>`, which a model already treats as
 * machine syntax rather than prose. `""` when nothing renders (every block
 * blank or disabled), so an empty sheet adds no lines to the prompt.
 */
export function wrapCharacter(id: string, blocks: Block[]): string {
  const lines = renderBlocks(blocks);
  if (!lines.length) return "";
  return `<<<CHARACTER ${id}>>>\n${lines.join("\n")}\n<<<END ${id}>>>`;
}

/**
 * Swap a block with its neighbour in `dir` — the whole of the block editor's
 * Move Up/Move Down. Clamped: a no-op index (out of range, or already at the
 * end being moved further) returns the SAME array reference, matching this
 * codebase's reference-diffing discipline (`roster.ts → setEntry`).
 */
export function moveBlock(blocks: Block[], index: number, dir: -1 | 1): Block[] {
  const target = index + dir;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) {
    return blocks;
  }
  const out = blocks.slice();
  [out[index], out[target]] = [out[target], out[index]];
  return out;
}

/** A fresh Text block — the shape every "+ Text Block" tap and default-sheet builder produces. */
export function makeTextBlock(title: string, text: string, kind: BlockKind = "custom"): TextBlock {
  return { id: crypto.randomUUID(), type: "text", kind, title, text, enabled: true };
}

/** A fresh Item block — always `kind: "custom"`, items have no mechanical role of their own. */
export function makeItemBlock(
  title: string,
  text: string,
  quantity = 1,
  attributeBonus?: { attribute: Attribute; amount: number },
  grantedSpecialisation?: string,
): ItemBlock {
  return {
    id: crypto.randomUUID(),
    type: "item",
    kind: "custom",
    title,
    text,
    quantity,
    enabled: true,
    ...(attributeBonus ? { attributeBonus } : {}),
    ...(grantedSpecialisation ? { grantedSpecialisation } : {}),
  };
}

/**
 * Indent a (possibly multi-line) block two spaces per line, blank lines left
 * alone — the nesting a character's rendered blocks get under their roster
 * entry (PC/party/NPC). Shared rather than duplicated: `prompt.ts` and
 * `cast.ts` both nest a `wrapCharacter` result and neither may import the
 * other (`prompt.ts` already imports `cast.ts`).
 */
export function indentBlock(block: string): string {
  return block
    .split("\n")
    .map((l) => (l ? `  ${l}` : l))
    .join("\n");
}
