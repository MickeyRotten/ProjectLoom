import type { Place } from "../types";
import { slug } from "./names";
import { keywordHits } from "./worldNotes";

/**
 * Places — the area the scene is in, one level above the room.
 *
 * `GameState.location` has always been ONE name, the most specific one
 * (`deltas.ts → simplifyLocation` enforces it), which is right for a scene
 * label and useless as context: the narrator knows it is in the "Damp Cellar"
 * and has to improvise the tavern, the town, the region and everyone in them,
 * fresh, every turn. A `Place` is the answer — the area, authored once by a
 * side call the first time the player walks into it, and then read back every
 * turn as authority.
 *
 * Slim by design: the per-kind tag taxonomy (steading/dungeon/wild, each with
 * its own tag schema, rooms, rumours) that used to live here has been
 * retired. The world-consistency job it was reaching for — factions, tone,
 * how dangerous things should feel — belongs one level up, in the world seed
 * (`Scenario`), authored once for the whole world instead of reinvented per
 * area. What is left is small on purpose: a name, a description, and the
 * words that pull it into the prompt when it is merely mentioned.
 *
 * What a place deliberately does NOT have: tags, rooms, coordinates, ladders
 * with arithmetic, theme countdowns, fronts, or a delta channel. The narrator
 * reads places; only the player writes them, and only the arrival call
 * authors them. This exists to give the narrator context, not to simulate a
 * world.
 *
 * Pure + tested — the drift guard for area injection.
 */

/* ------------------------------------------------------------------ *
 * Bounds
 * ------------------------------------------------------------------ */

/** Keywords one place may hold. */
export const MAX_KEYWORDS = 18;
/** Characters kept off any one free-text value. */
const MAX_VALUE_CHARS = 1200;

/* ------------------------------------------------------------------ *
 * Normalizing
 * ------------------------------------------------------------------ */

const text = (value: unknown, max = MAX_VALUE_CHARS): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

/**
 * Fold whatever is stored onto the current shape, at READ time.
 *
 * Sanitizing on read rather than on write is the same rule `normalizeDice`
 * follows: the editor can then write one field without having to rewrite the
 * next, and a document hand-edited or written by an older build still loads.
 * Blank stays blank — an empty description is a place the player emptied, not
 * a place to refill. A stored place from before this shrink carries
 * `kind`/`tags`/`rooms`/`rumours`/`coords`/`locations` too — none of those
 * keys are read here, so they are silently dropped, the same one-way cut
 * every prior retirement in this codebase has made.
 */
export function normalizePlace(raw: unknown, fallbackId = ""): Place | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Place>;
  const name = text(p.name, 80);
  const id = text(p.id, 60) || fallbackId;
  // A place with no name resolves to nothing and injects nothing; it is not a
  // place, it is a row that got away.
  if (!name || !id) return null;

  const place: Place = {
    id,
    name,
    description: text(p.description, MAX_VALUE_CHARS),
    keywords: list(p.keywords)
      .map((k) => text(k, 60))
      .filter(Boolean)
      .slice(0, MAX_KEYWORDS),
  };

  const aliases = list(p.aliases)
    .map((a) => text(a, 80))
    .filter(Boolean);
  if (aliases.length) place.aliases = aliases;
  if (p.pending) place.pending = true;
  return place;
}

/**
 * Normalize a stored list, dropping what cannot be a place. Returns the SAME
 * array reference when every entry was already current, so reversal's
 * reference-diff keeps working and a quiet turn snapshots nothing.
 */
export function normalizePlaces(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return [];
  const out: Place[] = [];
  let changed = false;
  for (const row of raw) {
    const place = normalizePlace(row);
    if (!place) {
      changed = true;
      continue;
    }
    if (!same(place, row as Place)) changed = true;
    out.push(place);
  }
  return changed ? out : (raw as Place[]);
}

/**
 * Whether normalizing left a stored row untouched — the test behind the
 * same-reference return above, and so behind reversal capturing nothing on a
 * turn that discovered nowhere.
 *
 * Field by field rather than `JSON.stringify`, because that compares KEY ORDER
 * too: a document whose keys happen to be stored in a different order is the
 * same place, and treating it as changed would snapshot the whole list on every
 * turn of every older save.
 */
function same(a: Place, b: Partial<Place> | undefined): boolean {
  if (!b) return false;
  const strings = (x: string[] | undefined, y: unknown): boolean => {
    const other = Array.isArray(y) ? y : [];
    return x?.length === other.length && (x ?? []).every((v, i) => v === other[i]);
  };
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.description === b.description &&
    Boolean(a.pending) === Boolean(b.pending) &&
    strings(a.keywords, b.keywords) &&
    strings(a.aliases ?? [], b.aliases ?? [])
  );
}

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

/** The names a place answers to: its own, plus every alias. */
export function placeNames(place: Place): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of [place.name, ...(place.aliases ?? [])]) {
    const name = raw.trim();
    const key = slug(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * The place a name resolves to, matched by slug across its own name and its
 * aliases — the same "a name is all the model knows" problem `names.ts` solves
 * for characters, and the same answer. Without aliases a narrator that starts
 * writing "the Murkwood" for "Murkwood" would author a second copy of the same
 * forest and lose the first.
 */
export function findPlace(places: Place[], name: string): Place | undefined {
  const key = slug(name);
  if (!key) return undefined;
  return places.find((p) => placeNames(p).some((n) => slug(n) === key));
}

/**
 * A named-but-unauthored place. Everything is blank except the name: a stub is
 * a fact ("there is somewhere called Rodstroke") standing in for a description
 * that has not arrived yet, and it resolves and injects like any other place so
 * an arrival is never authored twice.
 */
export function placeStub(id: string, name: string): Place {
  return { id, name: name.trim(), description: "", keywords: [], pending: true };
}

/**
 * The place named, appending a stub when this adventure has never heard of it.
 * Returns the SAME array when the name is already known or empty — the caller
 * reference-diffs to decide whether the turn touched anything.
 */
export function ensurePlace(places: Place[], name: string, id: string): Place[] {
  const trimmed = name.trim();
  if (!trimmed || !id || findPlace(places, trimmed)) return places;
  return [...places, placeStub(id, trimmed)];
}

/**
 * Write an authored place over the stub the arrival created, by id. A no-op on
 * an id that is no longer there — the player may have undone the turn that
 * discovered it while the call was in flight, and a late write must not
 * resurrect it. Same contract as `journal.ts → appendModelLines`, for the same
 * reason.
 *
 * The NAME is kept from the stub: it is what the narrator called the place, it
 * is what `GameState.area` holds, and letting the generator rename it would
 * strand the scene in a place that no longer resolves.
 */
export function fillPlace(places: Place[], id: string, authored: Place): Place[] {
  const found = places.find((p) => p.id === id);
  if (!found) return places;
  const merged: Place = { ...authored, id: found.id, name: found.name, aliases: found.aliases };
  if (!merged.aliases?.length) delete merged.aliases;
  delete merged.pending;
  return places.map((p) => (p.id === id ? merged : p));
}

/* ------------------------------------------------------------------ *
 * Injection
 * ------------------------------------------------------------------ */

/** How many keyword-matched places one turn may carry. */
export const PLACE_LIMIT = 3;

/**
 * The words that pull a place into the prompt when it is NOT the scene: its
 * name, its aliases and its explicit keywords.
 */
function placeKeywords(place: Place): string[] {
  return [...placeNames(place), ...place.keywords].filter(Boolean);
}

/**
 * The places the scan text names, excluding the one the scene is already in
 * (that rides in the state tier, in full). Word-boundary matched through the
 * shared `keywordHits`, so "mentioned" means the same thing here as it does for
 * World Notes and NPC sheets.
 */
export function matchPlaces(
  places: Place[],
  scanText: string,
  currentId?: string,
  limit = PLACE_LIMIT,
): Place[] {
  if (!scanText.trim()) return [];
  const matched: Place[] = [];
  for (const place of places) {
    if (matched.length >= limit) break;
    if (place.id === currentId) continue;
    if (placeKeywords(place).some((k) => keywordHits(k, scanText))) matched.push(place);
  }
  return matched;
}

/**
 * The `CURRENT AREA` block — the place the scene is in, in full. Lives in the
 * state tier (after the history, under its authority line) for the same reason
 * the pack and the quest board do: the beats remember a place already walked
 * out of, and this is what has to outrank them.
 *
 * A stub prints its name and nothing else. That is not a wasted block — "the
 * area is called Rodstroke" is exactly the fact the narrator would otherwise
 * re-invent on the next turn, and the authored version lands a moment later.
 */
export function formatCurrentPlaceBlock(place: Place | undefined): string {
  if (!place) return "";
  const lines = [`CURRENT AREA — ${place.name}`];
  if (place.description) lines.push(place.description);
  // The room is NOT restated here — CURRENT SCENE names it, one block up, and a
  // fact printed twice is a fact the narrator re-states back at the player.
  lines.push(
    "This is the area the player is in. Use it — its people, its trouble, its weather — instead of inventing somewhere new around them.",
  );
  return lines.join("\n");
}

/**
 * The `KNOWN PLACES` block — the trimmed entries for places the turn merely
 * NAMED. Name and description only: this is "you have heard of this", not
 * "you are standing in it", and shipping a full sheet for a town three days
 * away is how the narrator ends up narrating it.
 */
export function formatKnownPlacesBlock(places: Place[]): string {
  if (!places.length) return "";
  const entries = places.map((p) => {
    if (p.pending) return `- ${p.name} — known by name only.`;
    return p.description ? `- ${p.name}: ${p.description}` : `- ${p.name}`;
  });
  return [
    "KNOWN PLACES — somewhere this turn mentioned, elsewhere in the world",
    ...entries,
    "The player is NOT in these places. Refer to them as distant; do not set the scene in one unless the player travels there.",
  ].join("\n");
}
