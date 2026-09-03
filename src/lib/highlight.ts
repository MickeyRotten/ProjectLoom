import type { Character, Item } from "../types";
import { nameForms, slug } from "./names";

/**
 * Zelda-style prose highlighting (Appearance → Colors: Names & Items,
 * Dialogue). Known character/item names render bold + `--highlight`;
 * double-quoted dialogue renders in `--dialogue`. Pure, cheap, safe on
 * partial/unbalanced input — same contract as `markdown.ts → parseInline`
 * and `spotlight.ts → segmentDialogue`, which this sits alongside in
 * `ChatView.tsx`'s render pipeline.
 */

export interface HighlightSpan {
  text: string;
  kind: "plain" | "entity" | "quote" | "entity-in-quote";
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Quote glyphs treated as interchangeable open/close (straight + curly). */
const QUOTE_RE = /["“][^"“”]*["”]/g;

/**
 * Every distinct string worth highlighting: character names + aliases
 * (`nameForms`, every standing — a beat can name a departed or benched
 * character same as an active one), pack inventory labels, and equipped
 * gear labels. Deduped by `slug` so two spellings of the same name/label
 * don't ride the alternation twice.
 */
export function collectEntityNames(characters: Character[], inventory: Item[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    const name = (raw ?? "").trim();
    const key = slug(name);
    if (!name || !key || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  for (const c of characters) {
    for (const form of nameForms(c)) push(form);
    for (const e of c.equipment ?? []) push(e.label);
  }
  for (const item of inventory) push(item.label);
  return out;
}

/** Longest-first alternation over escaped `names`, or null when there are none. */
function buildEntityRe(names: string[]): RegExp | null {
  const forms = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!forms.length) return null;
  const alt = forms.map(escapeRe).join("|");
  return new RegExp(`(?<![\\w])(?:${alt})(?![\\w])`, "gi");
}

/** Split `text` on `re`'s matches into alternating unmatched/matched runs. */
function splitOn(text: string, re: RegExp | null, matchedKind: HighlightSpan["kind"]): HighlightSpan[] {
  if (!re || !text) return text ? [{ text, kind: "plain" }] : [];
  const out: HighlightSpan[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), kind: "plain" });
    out.push({ text: m[0], kind: matchedKind });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // guard against zero-width matches
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: "plain" });
  return out;
}

/**
 * Entity-highlight text already known to be dialogue (`spotlight.ts →
 * segmentDialogue`'s unwrapped `Name: "…"` segment bodies — no quote glyphs
 * to find, the caller already knows it's 100% inside quotes). Every entity
 * match is `entity-in-quote`: bold, but the dialogue color still owns it.
 */
export function highlightWithinQuote(text: string, names: string[]): HighlightSpan[] {
  return splitOn(text, buildEntityRe(names), "entity-in-quote");
}

/**
 * Split raw narrator prose into plain / entity / quote / entity-in-quote
 * runs. Quote spans are found first; entity matching then runs independently
 * inside each quoted and unquoted run.
 *
 * Precedence: color is quote > entity (a quoted clause stays one color, so
 * a sentence doesn't flicker between hues mid-clause); weight is entity >
 * quote (a highlighted noun still bolds inside dialogue). One CSS
 * declaration per span, never two colors on the same glyphs.
 */
export function highlightEntities(text: string, names: string[]): HighlightSpan[] {
  if (!text) return [];
  const entityRe = buildEntityRe(names);
  const out: HighlightSpan[] = [];
  for (const run of splitOn(text, new RegExp(QUOTE_RE), "quote")) {
    if (run.kind === "plain") {
      out.push(...splitOn(run.text, entityRe, "entity"));
    } else {
      out.push(...splitOn(run.text, entityRe, "entity-in-quote").map((s) => (s.kind === "plain" ? { ...s, kind: "quote" as const } : s)));
    }
  }
  return out;
}
