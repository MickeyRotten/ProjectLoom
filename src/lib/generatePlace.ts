import type { GameState, Place, PlaceTag, Settings } from "../types";
import { type ChatMessage, formatScenarioBlock } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import {
  MAX_ROOMS,
  MAX_RUMOURS,
  PLACE_KINDS,
  normalizePlace,
  placeHeading,
  placeKind,
  slotsOf,
} from "./places";
import { formatIdentity, playerCharacter } from "./roster";
import { formatWorldNotesBlock, matchWorldNotes } from "./worldNotes";

/**
 * AREA authoring — the side call that writes a `Place` the first time the
 * player walks into one.
 *
 * The odd one out among the generate* modules. `generateField.ts`,
 * `generateScenario.ts` and `generateItem.ts` are all ✦ buttons: the player asks,
 * a modal previews, nothing is written until they accept. This one is fired by
 * the STORY — a turn moved the scene somewhere new — so there is no preview and
 * no accept step, and it reads the beats the others are forbidden from reading.
 * That inversion is the point: what the player is walking into was just
 * described in the prose, and the whole reason to author a place is so the
 * narrator stops having to re-improvise it every turn afterwards.
 *
 * Fired AFTER the beat has landed, never before it: the call would otherwise sit
 * in front of the first token of the turn that arrives somewhere. The arrival
 * beat is improvised — it is arrival prose, which is exactly the kind a narrator
 * writes well — and every beat after it has the place in hand.
 *
 * Pure + tested: prompt assembly and parsing here, network in the store.
 */

/** Authoring, like every other generate* flow — a re-roll should differ. */
export const GENERATE_PLACE_TEMPERATURE = 0.9;

/** How many recent beats the call reads to see where the player just went. */
const ARRIVAL_BEATS = 4;

/** What the model is asked for, per kind. Bounds, not instructions. */
const ROOM_TARGET = "4 to 8";

export interface GeneratePlaceOptions {
  /** The adventure as it stands, with the arrival beat already in `messages`. */
  game: GameState;
  settings: Settings;
  /** The name the narrator gave this area — the one thing already decided. */
  name: string;
}

/**
 * The kinds, as the model sees them: what each one is, what its `type` may be,
 * and which tag slots it has. Generated from `PLACE_KINDS` rather than written
 * out, so the vocabulary the model is offered and the vocabulary the editor
 * shows can never drift apart.
 */
export function formatKindMenu(): string {
  const blocks = PLACE_KINDS.map((kind) => {
    const lines = [
      `"${kind.id}" — ${kind.hint}.`,
      `  "type": one of ${kind.types.join(" · ")} (or another word that fits better).`,
      // Every slot line is written as a path INTO "tags". Listed bare, they read
      // as siblings of "type" — top-level keys — which is exactly what a model
      // then emits, and every tag slot came back empty.
      `  "tags": {`,
    ];
    for (const slot of kind.slots) {
      const options = slot.options?.length ? ` Suggested: ${slot.options.join(" · ")}.` : "";
      const shape = slot.single ? "one string" : "an array of strings";
      lines.push(`    "${slot.key}": ${shape} — ${slot.hint}.${options}`);
    }
    lines.push("  }");
    return lines.join("\n");
  });
  return ["THE THREE KINDS OF PLACE", ...blocks].join("\n\n");
}

/**
 * A worked example of the whole object, assembled.
 *
 * The protocol had a page of field documentation and nothing showing the shape
 * put together — the same gap that made `options` unreliable in the turn block,
 * and fixed the same way. On a weak model one exemplar beats another paragraph
 * of rules, and it is the only place `tags` can be shown as what it is: nested,
 * ordinary, and filled in.
 */
export const PLACE_EXAMPLE = `{
  "kind": "steading",
  "type": "village",
  "description": "Forty souls in the crook of the river, hemmed in by wet fields. Every roof is thatch and every thatch is green with moss. The mill wheel has not turned since the frost.",
  "tags": {
    "prosperity": "Poor",
    "population": "Shrinking",
    "defenses": "Militia",
    "trade": ["Ennet Bend", "Torsea"],
    "tags": ["Resource(river fish)", "Need(grain)", "Personage(Halloway the miller)", "Lawless"]
  },
  "rumours": [
    "The miller's boy walked into the reeds at dusk and did not walk out.",
    "There is old coin under the mill, if you are fool enough to dig."
  ],
  "rooms": [
    { "name": "The Wend Mill", "description": "Wheel still, floor rotten, door barred from inside.", "unique": true },
    { "name": "Halloway's House", "description": "The only stone house, and the only shuttered one.", "unique": true },
    { "name": "Thatched Cottage", "description": "One of thirty, all of them damp.", "unique": false },
    { "name": "Fishing Stage", "description": "Rickety planking out over the brown water.", "unique": false }
  ],
  "keywords": ["the village", "Wend", "Halloway"]
}`;

/**
 * The places already authored, by name and kind only. Enough for the model to
 * place this one in a world that already exists — and to not re-describe a
 * neighbour it already wrote — without shipping every description it has ever
 * produced.
 */
export function formatKnownWorldBlock(places: Place[], name: string): string {
  const others = places.filter((p) => p.name.trim() && p.name !== name);
  if (!others.length) return "";
  const lines = others.map((p) => `- ${placeHeading(p)}${p.pending ? " (name only)" : ""}`);
  return [
    "ELSEWHERE IN THIS WORLD — places this adventure already knows",
    ...lines,
    "Do not re-describe these. You may name them as neighbours, trade partners or rumours.",
  ].join("\n");
}

/** The last few beats — what the player just did to arrive here. */
export function arrivalBeats(game: GameState, turns = ARRIVAL_BEATS): string {
  return game.messages
    .slice(-turns * 2)
    .map((m) => `${m.role === "player" ? "PLAYER" : "NARRATOR"}: ${m.content}`)
    .join("\n\n");
}

/**
 * The text the World Notes matcher scans: the area's name and the beats that
 * led here. Unlike the ✦ flows this one DOES read the story — the note about
 * the Sunken Choir belongs in the town the player just walked into because of
 * it.
 */
export function placeScanText(game: GameState, name: string): string {
  return [name, game.scenario.title, arrivalBeats(game)].filter(Boolean).join("\n");
}

/** The player character, whose arrival this is. */
function playerBlock(game: GameState): string {
  const pc = playerCharacter(game.characters, game.roster);
  if (!pc) return "";
  return [`PLAYER CHARACTER — ${formatIdentity(pc)}`, pc.description].filter(Boolean).join("\n");
}

/**
 * The messages[] for one area call: the contract and the kind menu, the
 * scenario, the world as it stands, who arrived, the beats that brought them,
 * and the World Notes those words touch.
 */
export function buildPlaceMessages(opts: GeneratePlaceOptions): ChatMessage[] {
  const { game, settings, name } = opts;
  const messages: ChatMessage[] = [];

  messages.push({
    role: "system",
    content: [
      `AREA — you are writing the reference sheet for one place in a text adventure: ${name}. The player has just arrived there.`,
      "Reply with a single JSON object and nothing else — no prose, no commentary, no code fences.",
      "",
      "THE OBJECT",
      '- "kind": one of "steading", "dungeon", "wild". This decides which other fields the place has.',
      '- "type": what sort of place it is, in a word.',
      '- "description": two to four sentences. What it looks like, what it is like to be there, and what is going on. Concrete and physical — this is read by the narrator every turn the player is here.',
      '- "tags": an OBJECT, whose keys are the tag slots listed below for the kind you chose. Every slot goes inside it — none of them is a top-level key. Fill in every slot: a place with no tags is a place the narrator has to keep inventing.',
      `- "rumours": up to ${MAX_RUMOURS} short lines of what is SAID about this place — hooks, warnings, local gossip, old stories. They are believed here; they do not have to be true.`,
      `- "rooms": ${ROOM_TARGET} parts of this place, each { "name", "description", "unique" }. "unique" is true for somewhere there is exactly one of (the warden's office, the shrine, the mayor's house) and false for somewhere that recurs (a cell block, a market stall, a game trail). "description" is one line.`,
      '- "keywords": a few words that should bring this place to the narrator\'s mind when it is mentioned from elsewhere — other names for it, its landmark, its ruler.',
      "",
      formatKindMenu(),
      "",
      "A WORKED EXAMPLE — the shape, assembled. Yours describes a different place.",
      PLACE_EXAMPLE,
      "",
      "RULES",
      "- Write the place, not a scene and not a story. Nothing the player does; nothing that happens next.",
      "- It belongs in this world: the scenario's setting, technology and tone decide what can exist here.",
      "- Stay consistent with what the beats below already say about this place. They are what the player has seen; do not contradict them.",
      "- Leave the player's own plans out of it. This sheet outlives them.",
    ].join("\n"),
  });

  const scenario = formatScenarioBlock(game.scenario);
  if (scenario) messages.push({ role: "system", content: scenario });

  // The narrator's own voice: an area written in the setting's idiom reads as
  // part of the same world, and this is the block that carries the idiom.
  const voice = settings.customInstructions.trim();
  if (voice) {
    messages.push({
      role: "system",
      content: `THE NARRATOR'S STANDING INSTRUCTIONS — the voice and tone of this world.\n${voice}`,
    });
  }

  const world = formatKnownWorldBlock(game.places, name);
  if (world) messages.push({ role: "system", content: world });

  const pc = playerBlock(game);
  if (pc) messages.push({ role: "system", content: pc });

  const notes = formatWorldNotesBlock(matchWorldNotes(game.worldNotes, placeScanText(game, name)));
  if (notes) messages.push({ role: "system", content: notes });

  const beats = arrivalBeats(game);
  if (beats) {
    messages.push({
      role: "system",
      content: `HOW THE PLAYER GOT HERE — the last few beats. Everything these already establish about ${name} is true.\n\n${beats}`,
    });
  }

  messages.push({
    role: "user",
    content: `Write the area sheet for ${name}. Emit the JSON object now.`,
  });

  return messages;
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/**
 * Flatten the reply's `tags` object onto the flat `PlaceTag[]` the place
 * stores. Keys are matched against the chosen kind's slots and anything else is
 * dropped — a `prosperity` on a swamp is the model answering a question it was
 * not asked, and keeping it would put a field on screen that the editor has
 * nowhere to draw.
 *
 * A single-value slot handed a list keeps the first entry; a list slot handed a
 * bare string keeps the string. Both shapes turn up, and neither is an error
 * worth failing a whole place over.
 */
export function parseTagObject(raw: unknown, kind: Place["kind"]): PlaceTag[] {
  if (!raw || typeof raw !== "object") return [];
  if (Array.isArray(raw)) return parseTagList(raw, kind);

  const source = raw as Record<string, unknown>;
  const tags: PlaceTag[] = [];

  for (const slot of slotsOf(kind)) {
    const value = source[slot.key];
    if (value === undefined || value === null) continue;
    // The free slot is the one place a nested object can legitimately turn up
    // ("tags": { "tags": [...] }), and the one place a bare list of prefixed
    // strings does too. Both route through the list reader.
    if (Array.isArray(value)) {
      const rows = parseTagList(value, kind, slot.key);
      for (const row of slot.single ? rows.slice(0, 1) : rows) tags.push(row);
      continue;
    }
    const single = scalar(value);
    if (single) tags.push({ slot: slot.key, value: single });
  }
  return tags;
}

/** A string or a number as text; anything else is not a value. */
function scalar(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * A LIST of tags, in the three shapes models reach for when they do not send
 * the documented object: bare values, `{ slot, value }` rows, and prefixed
 * strings ("Prosperity: Poor", "Defenses(Militia)").
 *
 * A bare value with no recognisable prefix lands in `fallback` — the slot being
 * read, or the kind's free slot. That is what makes "Lawless" work: it is a tag
 * with no slot name of its own, and it belongs in the free list.
 */
function parseTagList(rows: unknown[], kind: Place["kind"], fallback = "tags"): PlaceTag[] {
  const slots = slotsOf(kind);
  const tags: PlaceTag[] = [];

  for (const row of rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      const obj = row as Record<string, unknown>;
      const slot = scalar(obj.slot);
      const value = scalar(obj.value);
      if (value && slots.some((s) => s.key === slot)) tags.push({ slot, value });
      continue;
    }
    const text = scalar(row);
    if (!text) continue;

    // "Prosperity: Poor" / "Defenses(Militia)" — a slot naming itself inside a
    // flat list. Only a name the kind actually has counts; "Resource(grain)" is
    // not a slot, so it stays whole and lands in the free list.
    const prefixed = /^\s*([A-Za-z][\w -]*?)\s*(?::\s*|\(\s*)(.+?)\s*\)?\s*$/.exec(text);
    const named = prefixed && slots.find((s) => s.key === prefixed[1].trim().toLowerCase());
    if (named && prefixed[2].trim()) {
      tags.push({ slot: named.key, value: prefixed[2].trim() });
      continue;
    }
    tags.push({ slot: fallback, value: text });
  }
  return tags;
}

/**
 * Merge two readings of the same reply, `first` winning. A single-value slot
 * keeps one value; a list slot gains what the other reading found and it did
 * not.
 */
export function mergeTags(first: PlaceTag[], second: PlaceTag[], kind: Place["kind"]): PlaceTag[] {
  const slots = slotsOf(kind);
  const single = new Set(slots.filter((s) => s.single).map((s) => s.key));
  const order = new Map(slots.map((s, i) => [s.key, i]));
  const out = [...first];
  const taken = new Set(out.map((t) => `${t.slot} ${t.value.toLowerCase()}`));
  const filled = new Set(out.map((t) => t.slot));

  for (const tag of second) {
    if (single.has(tag.slot) && filled.has(tag.slot)) continue;
    const key = `${tag.slot} ${tag.value.toLowerCase()}`;
    if (taken.has(key)) continue;
    taken.add(key);
    filled.add(tag.slot);
    out.push(tag);
  }
  // Schema order, stably — the same order `setTagValues` rebuilds an edited
  // place in. Which of the two readings found a slot is an accident of how the
  // model laid its reply out, and it should not decide how the sheet reads.
  return out
    .map((tag, i) => ({ tag, i }))
    .sort((a, b) => {
      const slot = (order.get(a.tag.slot) ?? 99) - (order.get(b.tag.slot) ?? 99);
      return slot || a.i - b.i;
    })
    .map((row) => row.tag);
}

/**
 * Pull an authored place out of a model reply. Tolerant like every other parser
 * in the app (fences, preamble and trailing commas all survive) and strict
 * about exactly one thing: something has to be usable. A reply that parses to an
 * object with no description, no tags and no rooms is not an area sheet, and
 * writing it over the stub would replace "we know the name" with "we know the
 * name, and the model has already answered" — so it fails instead, and the stub
 * stays as it is.
 *
 * The `name` comes from the caller, not the reply: it is what the narrator
 * called the place and what `GameState.area` holds, so it is not the model's to
 * change.
 */
export function parseGeneratedPlace(raw: string, id: string, name: string): Place | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return null;

  const kind = placeKind(parsed.kind);
  const place = normalizePlace(
    {
      id,
      name,
      kind,
      type: parsed.type,
      description: parsed.description,
      // Read the documented nesting first, then the SAME reply again at the top
      // level. Models put the slots where the menu appeared to put them, and a
      // whole sheet of tags silently vanishing is worse than reading a key
      // twice — `mergeTags` keeps the nested answer where both spoke. Emit stays
      // canonical; only the read is lenient (`loomBlock.ts → normalizeOptions`).
      tags: mergeTags(
        parseTagObject(parsed.tags, kind),
        parseTagObject(parsed, kind),
        kind,
      ),
      rumours: parsed.rumours,
      rooms: parseRooms(parsed.rooms),
      keywords: parsed.keywords,
    },
    id,
  );
  if (!place) return null;
  if (!place.description && !place.tags.length && !place.rooms.length) return null;
  return place;
}

/** Rooms, tolerant of a plain list of names as well as the documented objects. */
function parseRooms(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ROOMS)
    .map((row) => (typeof row === "string" ? { name: row, description: "" } : row));
}
