import type { Place, PlaceKind, PlaceTag, Room } from "../types";
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
 * Three kinds, because one shape could not describe them. A dungeon has no
 * prosperity; a wilderness has no trade partners. What differs is *which tag
 * slots exist*, so the conditional rule lives in ONE table (`PLACE_KINDS`) that
 * drives the generator's prompt, the editor's fields and the prompt block
 * alike — rather than as three `if (kind === …)` ladders that drift.
 *
 * What a place deliberately does NOT have: ladders with arithmetic (nothing
 * updates a steading), theme countdowns (nothing advances them), fronts, or a
 * delta channel. The narrator reads places; only the player writes them, and
 * only the arrival call authors them. Every one of those was considered and
 * cut: this exists to give the narrator context, not to simulate a world.
 *
 * Pure + tested — the drift guard for area injection.
 */

/* ------------------------------------------------------------------ *
 * The kind schema
 * ------------------------------------------------------------------ */

/**
 * One tag slot on a kind of place.
 *
 * `options` are SUGGESTIONS, not a whitelist. They are shown to the model as a
 * vocabulary and to the player as a picker, but a value outside them is kept
 * verbatim — the same posture as a blank field in `normalizeImageTemplates`:
 * the app's list is a default, not a cage. Only the slot KEY is validated, and
 * a tag naming a slot this kind does not have is dropped.
 */
export interface TagSlot {
  key: string;
  label: string;
  /** Suggested values. Free text still lands. */
  options?: string[];
  /** One value (a picker), or a list (a set of chips). */
  single?: boolean;
  /** Values name OTHER places — see `neighbourNames`. */
  links?: boolean;
  /** What the generator is told this slot is for. */
  hint: string;
}

export interface PlaceKindDef {
  id: PlaceKind;
  label: string;
  /** What the kind is, for the generator and the kind picker. */
  hint: string;
  /** Suggested values for `Place.type`. Free text still lands. */
  types: string[];
  /** What this kind calls the parts of itself. */
  roomLabel: string;
  slots: TagSlot[];
}

/**
 * The free-text slot every kind carries, so there is always somewhere for a
 * fact the schema did not anticipate. Its options are the Dungeon World
 * steading tags, which is also why they are only suggestions: half of them are
 * meaningless on a swamp.
 */
const FREE_SLOT: TagSlot = {
  key: "tags",
  label: "Tags",
  hint: "anything else worth knowing in one or two words, with a payload in brackets where it needs one",
  options: [
    "Resource(x)",
    "Need(x)",
    "Oath(x)",
    "Enmity(x)",
    "Craft(x)",
    "Guild(x)",
    "Personage(x)",
    "Religion(x)",
    "History(x)",
    "Power(x)",
    "Exotic",
    "Market",
    "Safe",
    "Lawless",
    "Blight(x)",
    "Arcane",
    "Divine",
  ],
};

/**
 * The three kinds. Vocabularies ship as constants rather than as `Settings`
 * fields: every other prompt-shaped thing in the app is player-editable, but
 * three tag vocabularies is a screen's worth of UI for something the free-text
 * value already escapes. Easy to promote later if it earns it.
 */
export const PLACE_KINDS: PlaceKindDef[] = [
  {
    id: "steading",
    label: "Steading",
    hint: "somewhere people live — a village, a town, a keep, a city",
    types: ["village", "town", "keep", "city", "hamlet", "outpost", "port"],
    roomLabel: "Locations",
    slots: [
      {
        key: "prosperity",
        label: "Prosperity",
        single: true,
        options: ["Dirt", "Poor", "Moderate", "Wealthy", "Rich"],
        hint: "how much money is about, and so what can be bought here",
      },
      {
        key: "population",
        label: "Population",
        single: true,
        options: ["Exodus", "Shrinking", "Steady", "Growing", "Booming"],
        hint: "how the number of people here is going",
      },
      {
        key: "defenses",
        label: "Defenses",
        single: true,
        options: ["None", "Militia", "Watch", "Guard", "Garrison", "Battalion", "Legion"],
        hint: "who, if anyone, is under arms here",
      },
      {
        key: "trade",
        label: "Trade",
        links: true,
        hint: "the names of other settlements this one trades with — invent them if the world has none yet",
      },
      FREE_SLOT,
    ],
  },
  {
    id: "dungeon",
    label: "Dungeon",
    hint: "somewhere built or hollowed out and now dangerous — a tomb, a lair, a ruin",
    types: [
      "tomb",
      "prison",
      "mine",
      "lair",
      "stronghold",
      "shrine",
      "archive",
      "portal",
      "ruin",
      "sewer",
    ],
    roomLabel: "Areas",
    slots: [
      {
        key: "builder",
        label: "Builder",
        single: true,
        options: [
          "natural",
          "dwarves",
          "elves",
          "a cult",
          "a wizard",
          "a warlord",
          "a demon",
          "precursors",
          "unknown",
        ],
        hint: "who made it — with the type, this is what the place IS (a dwarven prison, a cult archive)",
      },
      {
        key: "ruination",
        label: "Ruination",
        single: true,
        options: [
          "arcane disaster",
          "a curse",
          "quake, fire or flood",
          "plague",
          "overrun by monsters",
          "war",
          "the seam ran dry",
          "simply abandoned",
        ],
        hint: "how it came to be as it is now",
      },
      {
        key: "themes",
        label: "Themes",
        options: [
          "rot and decay",
          "madness",
          "tricks and traps",
          "the unquiet dead",
          "secrets and treachery",
          "factions at war",
          "corruption",
          "forbidden knowledge",
          "bottomless hunger",
          "holy war",
        ],
        hint: "one to three short phrases that give the place its character; everything found here should answer to one of them",
      },
      FREE_SLOT,
    ],
  },
  {
    id: "wild",
    label: "Wilderness",
    hint: "the country between everywhere else — woods, marsh, mountains, a road",
    types: [
      "forest",
      "swamp",
      "hills",
      "mountains",
      "plains",
      "coast",
      "desert",
      "tundra",
      "river",
      "road",
      "waste",
    ],
    roomLabel: "Places",
    slots: [
      {
        key: "travel",
        label: "Travel",
        single: true,
        options: ["easy", "rough", "perilous"],
        hint: "how hard this country is to cross",
      },
      {
        key: "features",
        label: "Features",
        hint: "landmarks that make this stretch of country itself and not another",
      },
      {
        key: "denizens",
        label: "Denizens",
        hint: "who or what lives or roams here",
      },
      FREE_SLOT,
    ],
  },
];

/**
 * The kind a stored value names. Unknown falls to `wild` — the simplest of the
 * three and the only one that describes somewhere with no people and no walls,
 * which is the safest thing to be wrong about.
 */
export function placeKind(value: unknown): PlaceKind {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  const found = PLACE_KINDS.find((k) => k.id === key);
  return found ? found.id : "wild";
}

export function kindDef(kind: PlaceKind): PlaceKindDef {
  return PLACE_KINDS.find((k) => k.id === kind) ?? PLACE_KINDS[2];
}

/** The slots a kind declares, in schema order. */
export function slotsOf(kind: PlaceKind): TagSlot[] {
  return kindDef(kind).slots;
}

/* ------------------------------------------------------------------ *
 * Bounds
 * ------------------------------------------------------------------ */

/** Rooms one place may hold. A shack does not get forty. */
export const MAX_ROOMS = 14;
/** Rumours one place may hold. */
export const MAX_RUMOURS = 6;
/** Tags one place may hold, across every slot. */
export const MAX_TAGS = 18;
/** Characters kept off any one free-text value. */
const MAX_VALUE_CHARS = 200;

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
 * Sanitizing on read rather than on write is the same rule `normalizeDice` and
 * `normalizeQuickActions` follow: the editor can then write one field without
 * having to rewrite the next, and a document hand-edited or written by an older
 * build still loads. Blank stays blank — an empty description is a place the
 * player emptied, not a place to refill.
 */
export function normalizePlace(raw: unknown, fallbackId = ""): Place | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Place> & { tags?: unknown; rooms?: unknown };
  const name = text(p.name, 80);
  const id = text(p.id, 60) || fallbackId;
  // A place with no name resolves to nothing and injects nothing; it is not a
  // place, it is a row that got away.
  if (!name || !id) return null;

  const kind = placeKind(p.kind);
  const keys = new Set(slotsOf(kind).map((s) => s.key));

  const tags: PlaceTag[] = [];
  const seen = new Set<string>();
  for (const row of list(p.tags)) {
    if (tags.length >= MAX_TAGS) break;
    if (!row || typeof row !== "object") continue;
    const tag = row as Partial<PlaceTag>;
    const value = text(tag.value);
    const key = text(tag.slot, 40);
    // A tag naming a slot this kind does not have is dropped: prosperity on a
    // swamp is exactly the confusion the kinds exist to prevent, and a kind can
    // be changed on the editor screen.
    if (!value || !keys.has(key)) continue;
    const dedupe = `${key} ${slug(value)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    tags.push({ slot: key, value });
  }

  const rooms: Room[] = [];
  for (const row of list(p.rooms)) {
    if (rooms.length >= MAX_ROOMS) break;
    if (!row || typeof row !== "object") continue;
    const room = row as Partial<Room>;
    const roomName = text(room.name, 80);
    if (!roomName) continue;
    const entry: Room = { name: roomName, description: text(room.description, 300) };
    if (room.unique) entry.unique = true;
    rooms.push(entry);
  }

  const place: Place = {
    id,
    name,
    kind,
    type: text(p.type, 40),
    description: text(p.description, 1200),
    tags,
    rumours: list(p.rumours)
      .map((r) => text(r, 300))
      .filter(Boolean)
      .slice(0, MAX_RUMOURS),
    rooms,
    keywords: list(p.keywords)
      .map((k) => text(k, 60))
      .filter(Boolean)
      .slice(0, MAX_TAGS),
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
    a.kind === b.kind &&
    a.type === b.type &&
    a.description === b.description &&
    Boolean(a.pending) === Boolean(b.pending) &&
    strings(a.rumours, b.rumours) &&
    strings(a.keywords, b.keywords) &&
    strings(a.aliases ?? [], b.aliases ?? []) &&
    a.tags.length === (Array.isArray(b.tags) ? b.tags.length : -1) &&
    a.tags.every((t, i) => t.slot === b.tags?.[i]?.slot && t.value === b.tags?.[i]?.value) &&
    a.rooms.length === (Array.isArray(b.rooms) ? b.rooms.length : -1) &&
    a.rooms.every(
      (r, i) =>
        r.name === b.rooms?.[i]?.name &&
        r.description === b.rooms?.[i]?.description &&
        Boolean(r.unique) === Boolean(b.rooms?.[i]?.unique),
    )
  );
}

/* ------------------------------------------------------------------ *
 * Tags
 * ------------------------------------------------------------------ */

/** The values held in one slot, in stored order. */
export function tagValues(place: Place, slot: string): string[] {
  return place.tags.filter((t) => t.slot === slot).map((t) => t.value);
}

/**
 * Replace one slot's values, leaving every other slot alone. Rebuilt in SCHEMA
 * order rather than appended, so the editor and the prompt block print a place's
 * tags in the same order however they were typed.
 */
export function setTagValues(place: Place, slot: string, values: string[]): PlaceTag[] {
  const next = new Map<string, string[]>();
  for (const s of slotsOf(place.kind)) {
    next.set(s.key, s.key === slot ? values : tagValues(place, s.key));
  }
  const tags: PlaceTag[] = [];
  for (const s of slotsOf(place.kind)) {
    for (const value of next.get(s.key) ?? []) {
      const trimmed = value.trim();
      if (trimmed) tags.push({ slot: s.key, value: trimmed });
    }
  }
  return tags.slice(0, MAX_TAGS);
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
  return {
    id,
    name: name.trim(),
    kind: "wild",
    type: "",
    description: "",
    tags: [],
    rumours: [],
    rooms: [],
    keywords: [],
    pending: true,
  };
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
 * The other settlements a place's `links` tags name — its trade partners. Free
 * world-building: authoring one town names three neighbours, each of which
 * becomes a stub the keyword matcher can already inject, and any of which is
 * fully authored the moment the player walks there. No extra call.
 */
export function neighbourNames(place: Place): string[] {
  const linked = new Set(
    slotsOf(place.kind)
      .filter((s) => s.links)
      .map((s) => s.key),
  );
  const names: string[] = [];
  for (const tag of place.tags) {
    if (!linked.has(tag.slot)) continue;
    const name = tag.value.trim();
    if (name && !names.some((n) => slug(n) === slug(name))) names.push(name);
  }
  return names;
}

/**
 * Add a stub for every neighbour a place names that this adventure does not
 * already know — itself included, so a tag naming its own town is a no-op.
 * `nextId` is supplied by the caller (the store), keeping this pure.
 */
export function addNeighbourStubs(
  places: Place[],
  place: Place,
  nextId: () => string,
): Place[] {
  let out = places;
  for (const name of neighbourNames(place)) {
    if (slug(name) === slug(place.name)) continue;
    const grown = ensurePlace(out, name, nextId());
    if (grown !== out) out = grown;
  }
  return out;
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
  const merged: Place = {
    ...authored,
    id: found.id,
    name: found.name,
    aliases: found.aliases,
    pending: undefined,
  };
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
 * name, its aliases and its explicit keywords. Room names are deliberately not
 * among them — "the cellar" would drag a whole town in from three regions away.
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

/** `Rodstroke — town` / `Korvenhald — dwarven prison` / `Murkwood — forest`. */
export function placeHeading(place: Place): string {
  const builder = place.tags.find((t) => t.slot === "builder")?.value;
  const kind = [builder, place.type].filter(Boolean).join(" ");
  return kind ? `${place.name} — ${kind}` : place.name;
}

/** The tag lines for a place, one per slot that has anything in it. */
function tagLines(place: Place): string[] {
  const lines: string[] = [];
  for (const slot of slotsOf(place.kind)) {
    // `builder` is already in the heading — printing it again is the same fact
    // twice, which is the one thing the prompt's tiers exist to prevent.
    if (slot.key === "builder") continue;
    const values = place.tags.filter((t) => t.slot === slot.key).map((t) => t.value);
    if (!values.length) continue;
    lines.push(`${slot.label}: ${values.join(", ")}`);
  }
  return lines;
}

/**
 * The room list. Common and unique are printed as two labelled groups rather
 * than one list with a flag, because the instruction differs per group and a
 * per-row marker gets read as decoration.
 */
function roomLines(place: Place): string[] {
  if (!place.rooms.length) return [];
  const label = kindDef(place.kind).roomLabel.toUpperCase();
  const lines: string[] = [];
  const common = place.rooms.filter((r) => !r.unique);
  const unique = place.rooms.filter((r) => r.unique);

  if (common.length) {
    lines.push(`${label} — you may use these as often as the place needs them:`);
    for (const r of common) lines.push(`- ${r.name}${r.description ? `: ${r.description}` : ""}`);
  }
  if (unique.length) {
    lines.push(
      `${label}, ONE OF EACH — this place holds exactly one of these, so never write a second:`,
    );
    for (const r of unique) lines.push(`- ${r.name}${r.description ? `: ${r.description}` : ""}`);
  }
  return lines;
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
  const lines = [`CURRENT AREA — ${placeHeading(place)}`];
  if (place.description) lines.push(place.description);
  lines.push(...tagLines(place));

  if (place.rumours.length) {
    lines.push("Said locally (believed here — not necessarily true):");
    for (const r of place.rumours) lines.push(`- ${r}`);
  }

  lines.push(...roomLines(place));

  // The room is NOT restated here — CURRENT SCENE names it, one block up, and a
  // fact printed twice is a fact the narrator re-states back at the player.
  lines.push(
    "This is the area the player is in. Use it — its people, its trouble, its weather, the parts of it listed above — instead of inventing somewhere new around them.",
  );
  return lines.join("\n");
}

/**
 * The `KNOWN PLACES` block — the trimmed entries for places the turn merely
 * NAMED. Name, kind and a description only: this is "you have heard of this",
 * not "you are standing in it", and shipping a full room list for a town three
 * days away is how the narrator ends up narrating it.
 */
export function formatKnownPlacesBlock(places: Place[]): string {
  if (!places.length) return "";
  const entries = places.map((p) => {
    const head = `- ${placeHeading(p)}`;
    if (p.pending) return `${head} — known by name only.`;
    return p.description ? `${head}: ${p.description}` : head;
  });
  return [
    "KNOWN PLACES — somewhere this turn mentioned, elsewhere in the world",
    ...entries,
    "The player is NOT in these places. Refer to them as distant; do not set the scene in one unless the player travels there.",
  ].join("\n");
}
