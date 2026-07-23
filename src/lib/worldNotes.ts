import type { Note } from "../types";

/**
 * World Notes keyword matching (DESIGN.md → Prompt assembly #7, simplified
 * `match_entries`). Single-category lorebook: a note is injected when one of
 * its keywords — or its title, an implicit keyword — appears in the scan text
 * (the new player message + the last few beats).
 *
 * Pure + tested: this is the drift guard for lore injection.
 */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Title is always an implicit keyword; explicit keywords augment it. */
function noteKeywords(note: Note): string[] {
  return [note.title, ...note.keywords]
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * A keyword matches when it appears in `text` on word boundaries
 * (case-insensitive) — so "well" hits "the well" but not "farewell". Multi-word
 * keywords match as a loose phrase (internal whitespace is flexible).
 */
function keywordHits(keyword: string, text: string): boolean {
  const pattern = escapeRe(keyword).replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\w])${pattern}(?![\\w])`, "i").test(text);
}

/**
 * Notes whose title or keywords appear in `scanText`, in original order,
 * de-duplicated. A note with no usable keywords never matches.
 */
export function matchWorldNotes(notes: Note[], scanText: string): Note[] {
  if (!scanText.trim()) return [];
  const matched: Note[] = [];
  for (const note of notes) {
    const keys = noteKeywords(note);
    if (!keys.length) continue;
    if (keys.some((k) => keywordHits(k, scanText))) matched.push(note);
  }
  return matched;
}

/** The `WORLD NOTES` prompt block for the matched notes, or "" if none. */
export function formatWorldNotesBlock(notes: Note[]): string {
  if (!notes.length) return "";
  const entries = notes
    .map((n) => `- ${n.title}${n.content ? `: ${n.content}` : ""}`)
    .join("\n");
  return `WORLD NOTES — relevant lore for this turn\n${entries}`;
}
