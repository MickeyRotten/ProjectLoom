import type { GameState, Note } from "../types";
import { type ChatMessage, formatScenarioBlock } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";

/**
 * WORLD NOTE generation — the fourth ✦ flow, beside `generateField.ts` (one
 * field of a character sheet), `generateScenario.ts` (one field of the setup)
 * and `generateItem.ts` (a whole gear row). This one writes a whole NOTE: the
 * lorebook entry the player types by hand is a title, a content paragraph and a
 * few keywords, so the whole thing generates together — and, since a note with
 * no title can never be matched, "suggest name and keywords" is the point of it,
 * not an extra.
 *
 * Same contract as its siblings — one call, a single JSON object parsed
 * tolerantly, a preview the player accepts or re-rolls, and nothing written
 * until they do — with `generateItem.ts`'s wrinkle: a title, a content and a set
 * of keywords stand or fall together (a keyword list for a note the model never
 * named matches nothing), so the reply carries all three and has a parser of its
 * own.
 *
 * AUTHORING, like the three ✦ siblings: it reads the scenario and the lore the
 * player has already written — never the beats. A note is standing lore, and the
 * one being written does not come out of any particular turn.
 *
 * Pure + tested: prompt assembly and response parsing here, network in the store.
 */

/** What comes back — the three values a `Note` holds that a model may write. */
export interface GeneratedNote {
  title: string;
  content: string;
  keywords: string[];
}

/** Authoring, like the other ✦ flows — a re-roll should differ, not hedge. */
export const GENERATE_NOTE_TEMPERATURE = 0.9;

/**
 * A ceiling on the keyword list, not a rule: a model that answers with a
 * paragraph of near-synonyms would otherwise put thirty match terms on one note.
 */
export const MAX_NOTE_KEYWORDS = 8;

/** Notes worth showing the model as context — a blank note names nothing. */
function filled(notes: Note[]): Note[] {
  return notes.filter((n) => n.title.trim() || n.content.trim());
}

export interface GenerateNoteOptions {
  game: GameState;
  /**
   * The lore already written, WITHOUT the note being generated: that one is a
   * draft to replace, and listing it would tell the model not to write the very
   * thing the player pressed ✦ on.
   */
  existing: Note[];
  /**
   * The note being written, as shown on screen. A player who has already typed a
   * title wants it kept, so it is fed back as a starting point rather than
   * treated as an empty slot.
   */
  draft?: Note;
  /**
   * Send the Scenario as setting context. The player's box on the modal, since
   * some lore is meant to sit apart from the adventure's own premise. Defaults to
   * on — leaving it out keeps the scenario, so callers that never ask are
   * unchanged.
   */
  useScenario?: boolean;
  /** The player's optional "what I want in it" note. */
  hint?: string;
}

/**
 * The lore the model is shown for consistency and de-duplication. Only for
 * context — the note being written is excluded by the caller, so this is
 * everything the player has ALREADY established about the world.
 */
export function formatKnownLoreBlock(existing: Note[]): string {
  const notes = filled(existing);
  if (!notes.length) return "";
  const lines = notes.map((n) => `- ${n.title.trim()}${n.content.trim() ? `: ${n.content.trim()}` : ""}`);
  return [
    "LORE ALREADY WRITTEN — the world notes this adventure already has",
    ...lines,
    "Write a DIFFERENT note. You may reference these, but do not restate one.",
  ].join("\n");
}

/** The note as a starting point, when the player has typed anything into it. */
function draftBlock(draft?: Note): string {
  if (!draft) return "";
  const lines = [
    draft.title.trim() ? `Working title: ${draft.title.trim()}` : "",
    draft.content.trim() ? `So far: ${draft.content.trim()}` : "",
    draft.keywords.length ? `Keywords so far: ${draft.keywords.join(", ")}` : "",
  ].filter(Boolean);
  if (!lines.length) return "";
  return [
    "STARTING POINT — what the player has typed into this note so far. Keep the",
    "title if there is one; build the note out from here.",
    ...lines,
  ].join("\n");
}

/** The rules for the note itself. */
const NOTE_RULES = [
  `- "title" is what the entry is CALLED — a name or a short noun phrase (a place, a person, a faction, a custom), in plain title case, with no punctuation and no markdown. Keep the player's working title if one is given.`,
  `- "content" is one short paragraph of standing lore: a fact about the WORLD that stays true between turns. Concrete and specific. Not a scene, not a quest, not something happening now.`,
  `- "keywords" is a short array of extra words or phrases that should bring this note to the narrator's mind when they come up in play — other names, aliases, related terms. The title is already a keyword, so do not repeat it. Lowercase plain words, no punctuation.`,
];

/**
 * The messages[] for one note call: role + the note rules, the scenario, the
 * lore already written, the player's starting point when there is one, the
 * World Notes… well, this IS the world notes, so the lore block stands in for
 * them, and the player's hint when they gave one.
 */
export function buildNoteMessages(opts: GenerateNoteOptions): ChatMessage[] {
  const { game, existing, draft } = opts;
  const hint = (opts.hint ?? "").trim();

  const messages: ChatMessage[] = [];

  messages.push({
    role: "system",
    content: [
      "WORLD NOTE — you are writing ONE lorebook entry for a text adventure: a standing fact about the world that the narrator is reminded of when it is mentioned.",
      `Reply with a single JSON object and nothing else — no prose, no commentary, no code fences. It has exactly three keys: "title" and "content" (plain strings) and "keywords" (an array of plain strings).`,
      "",
      "THE NOTE",
      ...NOTE_RULES,
      "",
      "RULES",
      "- Write ONE note about ONE subject. Not a list, not several entries in one.",
      "- It belongs in this world: the scenario's setting, technology and tone decide what can exist.",
      "- Write LORE, not a plot: something that is true of the world, not something the player must do.",
      "- Do not restate a note already written below — write a new subject.",
    ].join("\n"),
  });

  if (opts.useScenario ?? true) {
    const scenario = formatScenarioBlock(game.scenario);
    if (scenario) messages.push({ role: "system", content: scenario });
  }

  const lore = formatKnownLoreBlock(existing);
  if (lore) messages.push({ role: "system", content: lore });

  const start = draftBlock(draft);
  if (start) messages.push({ role: "system", content: start });

  // Last, so it outranks everything above it — the player asking for a note
  // about the drowned city gets the drowned city, whatever the lore already has.
  if (hint) {
    messages.push({
      role: "system",
      content: `PLAYER GUIDANCE — what the player wants this note to be about. Follow it.\n${hint}`,
    });
  }

  messages.push({
    role: "user",
    content: "Write one world note. Emit the JSON object now.",
  });

  return messages;
}

/**
 * The keyword list, sanitized. Accepts the documented array, and the two other
 * shapes models reach for — a comma/newline-separated string, and a list with
 * stray non-strings — trims, drops blanks and the title (already an implicit
 * keyword), de-duplicates case-insensitively, and caps the count so a note can
 * never carry an essay's worth of match terms.
 */
export function normalizeNoteKeywords(value: unknown, title = ""): string[] {
  const raw: string[] =
    typeof value === "string"
      ? value.split(/[,\n]/)
      : Array.isArray(value)
        ? value.map((v) => (typeof v === "string" ? v : ""))
        : [];

  const titleKey = title.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const word = entry.trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (key === titleKey || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= MAX_NOTE_KEYWORDS) break;
  }
  return out;
}

/**
 * Pull the note out of a model reply. Tolerant like the <<<LOOM>>> parser
 * (fences / preamble / trailing commas survive), strict about content: a note
 * with no title can never be matched into a turn, so a titleless reply reads as
 * "nothing came back" and the note is left exactly as the player had it. A blank
 * content or an empty keyword list is only a blank field, which the player can
 * fill in, so neither is a failure.
 *
 * Its own parser rather than three `parseGeneratedField` calls (the reasoning
 * `generateItem.ts` gives): the three values stand together, and keywords are an
 * array, not a string.
 */
export function parseGeneratedNote(raw: string): GeneratedNote | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return null;

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  if (!title) return null;

  return {
    title,
    content: typeof parsed.content === "string" ? parsed.content.trim() : "",
    keywords: normalizeNoteKeywords(parsed.keywords, title),
  };
}
