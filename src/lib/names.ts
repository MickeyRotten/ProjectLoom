import type { Character } from "../types";

/**
 * Name identity — how a character is matched by name, and what happens when
 * that name changes.
 *
 * A character is keyed by `id` everywhere it is STORED (roster entries,
 * portrait cache keys, reversal snapshots), but by NAME everywhere the model
 * touches them: the narrator only ever knows a character as a string, so party
 * ops, conditions, speaker detection, NPC keyword gating and Auto-Update's
 * story scan all resolve a name back to a character.
 *
 * That made a rename impossible. The narrator introduces someone before the
 * scene has a name for them ("Unnamed Goblin"), and when a name finally lands
 * it has no way to say *this is the same person* — so it emits a fresh `add`
 * and the party holds two of them. Renaming in place was no better: the id and
 * the portrait survive, but every one of the name-keyed paths above reads a
 * history full of the OLD name and quietly stops matching.
 *
 * So a rename keeps the old name. `Character.aliases` is the list of names a
 * character has answered to, most recent last, and `nameForms` — not
 * `c.name` — is what every matcher takes. The narrator can rename ("newName"
 * on a party op) and the player can rename (the member sheet), and neither
 * loses the history that came before.
 *
 * A leaf module on purpose: `deltas.ts` already imports `roster.ts`, so the
 * matcher cannot live in either without a cycle.
 */

/**
 * How a name or a label is matched everywhere in this app — case, punctuation
 * and spacing folded away. Shared by the narrator's deltas and by gear moving
 * between the pack and a character's kit (`equip.ts`); two spellings of
 * "match" is how an item ends up listed twice.
 */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * How many former names a character keeps. Bounded because every form widens
 * the regexes in `spotlight.ts` and rides in the prompt's identity line — a
 * character renamed a dozen times should not cost a dozen alternations.
 * The OLDEST are dropped: the recent ones are the ones the history still says.
 */
export const MAX_ALIASES = 3;

/** Former names shown to the model on the identity line. */
const AKA_SHOWN = 2;

type Named = Pick<Character, "name"> & { aliases?: Character["aliases"] };

/**
 * Every name a character answers to — their current name first, then their
 * former ones, newest first. Deduped by slug and defensive about what it reads:
 * `aliases` is optional and rides in saved documents, so a hand-edited or
 * older-build save must not be able to crash a matcher.
 */
export function nameForms(c: Named): string[] {
  const forms: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const name = raw.trim();
    const key = slug(name);
    if (!name || !key || seen.has(key)) return;
    seen.add(key);
    forms.push(name);
  };

  push(c.name);
  if (Array.isArray(c.aliases)) for (let i = c.aliases.length - 1; i >= 0; i--) push(c.aliases[i]);
  return forms;
}

/** Does `name` name this character — under their current name or an old one? */
export function matchesName(c: Named, name: string): boolean {
  const key = slug(name);
  if (!key) return false;
  return nameForms(c).some((form) => slug(form) === key);
}

/**
 * The character a narrator-written name resolves to, or undefined. `members`
 * restricts the search to role "member", which is what party ops want — the PC
 * is never moved by a party delta. Conditions pass it false: a mark lands on
 * the player more often than on anyone else.
 */
export function findByName(
  characters: Character[],
  name: string,
  opts: { members?: boolean } = {},
): Character | undefined {
  if (!slug(name)) return undefined;
  return characters.find(
    (c) => (!opts.members || c.role === "member") && matchesName(c, name),
  );
}

/**
 * The rename itself — pure, and the ONE writer of `aliases`, so the narrator's
 * "newName" op and the player's member-sheet edit cannot disagree about what a
 * rename means.
 *
 * Returns the SAME object when the name is blank or only differs in case and
 * punctuation, so callers can reference-diff. The old name goes to the front of
 * the alias list; any alias the new name reclaims is dropped, so renaming back
 * and forth can never leave a character aliased to their own name.
 */
export function withRename<T extends Character>(c: T, newName: string): T {
  const name = newName.trim();
  if (!name || !slug(name) || slug(name) === slug(c.name)) return c;

  const keep = slug(name);
  const aliases = [c.name, ...(Array.isArray(c.aliases) ? c.aliases : [])]
    .filter((a): a is string => typeof a === "string" && !!slug(a) && slug(a) !== keep)
    .filter((a, i, all) => all.findIndex((b) => slug(b) === slug(a)) === i)
    .slice(0, MAX_ALIASES);

  return { ...c, name, aliases };
}

/**
 * Former names as the model reads them, e.g. `earlier "the Hooded Stranger"`.
 * Blank when there are none. Capped at `AKA_SHOWN`: this rides in the identity
 * line of every party sheet, every turn, and the point is only to connect the
 * name the history says to the name the roll call says.
 */
export function formatAka(c: Named): string {
  const former = nameForms(c).slice(1, 1 + AKA_SHOWN);
  if (!former.length) return "";
  return `earlier ${former.map((n) => `"${n}"`).join(", ")}`;
}

/**
 * A comma-separated alias list, for the member sheet's one text field. Parsing
 * drops blanks and duplicates and caps the list the same way a rename does, so
 * a typed field and a narrator rename produce the same shape.
 */
export function parseAliases(text: string, name = ""): string[] {
  const taken = new Set([slug(name)].filter(Boolean));
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const alias = raw.trim();
    const key = slug(alias);
    if (!alias || !key || taken.has(key)) continue;
    taken.add(key);
    out.push(alias);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}
