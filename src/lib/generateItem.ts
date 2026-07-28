import type { Character, Equipment, GameState, Item } from "../types";
import { type ChatMessage, formatScenarioBlock } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { formatSheet } from "./autoUpdate";
import { equipLine } from "./equip";
import { formatWorldNotesBlock, matchWorldNotes } from "./worldNotes";

/**
 * ITEM generation — the third ✦ flow, beside `generateField.ts` (one field of a
 * character sheet) and `generateScenario.ts` (one field of the setup). This one
 * writes a whole ROW: the two places a player types gear by hand are the shared
 * pack (Inventory) and one character's kit (the member sheet's Equipment), and
 * both rows are the same three values, so both get the same button.
 *
 * Same contract as its siblings — one call, a single JSON object parsed
 * tolerantly, a preview the player accepts or re-rolls, and nothing written
 * until they do — with one difference: an item is not one field but three, so
 * the reply carries `label`, `description` and `quantity` together. Splitting
 * that into three calls would let the description describe something the label
 * never named.
 *
 * AUTHORING, like both siblings: it reads the scenario, whatever is already
 * carried, the character when there is one, and the World Notes those words
 * touch — never the beats. The item being added does not exist in the story yet.
 *
 * Pure + tested: prompt assembly and response parsing here, network in the store.
 */

/** What comes back — the three values an inventory / equipment row holds. */
export interface GeneratedItem {
  label: string;
  description: string;
  /** Always a whole number ≥ 1; the model's value is sanitized, never trusted. */
  quantity: number;
}

/**
 * A row of either list. `Item` (pack) and `Equipment` (kit) differ only in
 * whether the count is optional, so one shape describes both and neither screen
 * needs its own prompt builder.
 */
export type ItemRow = Pick<Item, "label" | "description"> & Pick<Equipment, "quantity">;

/** Authoring, like the other ✦ flows — a re-roll should differ, not hedge. */
export const GENERATE_ITEM_TEMPERATURE = 0.9;

/**
 * A ceiling on the count, not a rule about the world: a model that answers the
 * quantity question with a year or a price would otherwise put it straight into
 * the player's pack.
 */
export const MAX_ITEM_QUANTITY = 999;

/** Rows worth showing the model — a blank row names nothing. */
function filled(rows: ItemRow[]): ItemRow[] {
  return rows.filter((r) => r.label.trim() || r.description.trim());
}

/**
 * The text the World Notes matcher scans: what the player asked for, what is
 * already carried, and who is carrying it. A note about the Ashen Legion is
 * pulled in because the player typed their banner, not because it came up three
 * turns ago — this is authoring, so the story is not scanned.
 */
export function itemScanText(
  existing: ItemRow[],
  character?: Character,
  hint?: string,
): string {
  return [
    hint ?? "",
    ...existing.flatMap((r) => [r.label, r.description]),
    character?.name ?? "",
    character?.species ?? "",
    character?.description ?? "",
    character?.strengths ?? "",
  ]
    .filter((s) => s.trim())
    .join("\n");
}

/**
 * What is already there, so the model writes a second thing rather than the
 * same thing again. Only for the pack: a character's kit is already listed in
 * their sheet (`formatSheet`), and printing it twice invites the model to treat
 * the two copies as two sets of gear.
 */
export function formatPackBlock(existing: ItemRow[]): string {
  const rows = filled(existing);
  if (!rows.length) return "ALREADY IN THE PACK — nothing yet.";
  const lines = rows.map((r) => `- ${equipLine(r)}`);
  return `ALREADY IN THE PACK — what the party is already carrying\n${lines.join("\n")}`;
}

export interface GenerateItemOptions {
  game: GameState;
  /**
   * The rows already in the list being added to, WITHOUT the row being written:
   * that one is a draft to replace, and listing it would forbid the very thing
   * the player pressed ✦ on.
   */
  existing: ItemRow[];
  /**
   * Set when writing a piece of EQUIPMENT — the character it is being written
   * for, as shown on screen (the sheet's edit draft). Absent for the shared
   * pack, which belongs to nobody in particular.
   */
  character?: Character;
  /** The player's optional "what I want" note. */
  hint?: string;
}

/** The rules for the item itself, shared by both flavours. */
const ITEM_RULES = [
  `- "label" is what the item is CALLED — a few words, in plain title case, with no count, no punctuation and no markdown.`,
  `- "description" is one or two sentences: what it is, what it looks like, and what it is good for. Concrete and physical.`,
  `- "quantity" is a whole number, and it is 1 unless the item is naturally carried in numbers (arrows, rations, coins, vials).`,
];

/**
 * The messages[] for one item call: role + the item rules, the scenario, who it
 * is for when it is for someone, what is already carried, the World Notes those
 * words touch, and the player's hint when they gave one.
 */
export function buildItemMessages(opts: GenerateItemOptions): ChatMessage[] {
  const { game, existing, character } = opts;
  const hint = (opts.hint ?? "").trim();
  const forCharacter = !!character;
  const what = forCharacter ? "a piece of EQUIPMENT" : "an ITEM for the party's shared pack";

  const messages: ChatMessage[] = [];

  messages.push({
    role: "system",
    content: [
      `ITEM — you are writing ONE item for a text adventure: ${what}.`,
      `Reply with a single JSON object and nothing else — no prose, no commentary, no code fences. It has exactly three keys: "label" and "description" (plain strings) and "quantity" (a number).`,
      "",
      "THE ITEM",
      ...ITEM_RULES,
      "",
      "RULES",
      "- Write ONE item. Not a set, not a bundle of different things, not a list.",
      "- It belongs in this world: the scenario's setting, technology and tone decide what can exist.",
      "- Do not write anything already listed below — the player has that one.",
      // Loot tables and rarity tiers are the reflex here, and this game has
      // neither: nothing in the app reads a stat line, so one would be noise the
      // player has to delete by hand.
      "- No stats, no rules text, no rarity or level. This game has none of that — write the thing itself.",
      forCharacter
        ? "- Write gear this particular character would own and carry — read their sheet below."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const scenario = formatScenarioBlock(game.scenario);
  if (scenario) messages.push({ role: "system", content: scenario });

  if (character) {
    // The sheet carries the kit with it, so this is also the "already carried"
    // list for the equipment flavour — hence `existing` on the sheet rather than
    // whatever was last saved.
    messages.push({
      role: "system",
      content: formatSheet({ ...character, equipment: filled(existing) }),
    });
  } else {
    messages.push({ role: "system", content: formatPackBlock(existing) });
  }

  const notes = formatWorldNotesBlock(
    matchWorldNotes(game.worldNotes, itemScanText(existing, character, hint)),
  );
  if (notes) messages.push({ role: "system", content: notes });

  // Last, so it outranks everything above it — the player asking for a lantern
  // gets a lantern, whatever the pack already holds.
  if (hint) {
    messages.push({
      role: "system",
      content: `PLAYER GUIDANCE — what the player wants this item to be. Follow it.\n${hint}`,
    });
  }

  messages.push({
    role: "user",
    content: forCharacter
      ? `Write one item for ${character?.name.trim() || "this character"} to carry. Emit the JSON object now.`
      : "Write one item for the pack. Emit the JSON object now.",
  });

  return messages;
}

/**
 * The count, sanitized. The model is answering a question about how many
 * arrows there are, and a stray year, price or "a few" must not become the
 * number in the player's pack: anything unreadable reads as one, fractions
 * round down, and the value is pinned to 1…`MAX_ITEM_QUANTITY`.
 */
export function normalizeItemQuantity(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.floor(n), 1), MAX_ITEM_QUANTITY);
}

/**
 * Pull the item out of a model reply. Tolerant like the <<<LOOM>>> parser
 * (fences / preamble / trailing commas survive), strict about content: an item
 * with no label is nothing at all, so that reads as "nothing came back" and the
 * row is left exactly as the player had it. A missing description is only a
 * blank field, which the player can type into, so it is not a failure.
 *
 * Its own parser rather than three `parseGeneratedField` calls: that one answers
 * "what is this field's string", and here the three values stand or fall
 * together — a description accepted without its label would describe an item
 * that has no name.
 */
export function parseGeneratedItem(raw: string): GeneratedItem | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return null;

  const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
  if (!label) return null;

  return {
    label,
    description: typeof parsed.description === "string" ? parsed.description.trim() : "",
    quantity: normalizeItemQuantity(parsed.quantity),
  };
}
