import type { AreaCard, Arc, Coord, GameState, RoomSlot, TurnOutcome } from "../types";
import { slug } from "./names";

/**
 * The gazetteer — how a place NAME becomes a key, which area a room belongs to,
 * where a room sits on the map, and when a card has gone stale.
 *
 * Two rules hold this file together, and both are lessons the project has
 * already learned the hard way somewhere else:
 *
 *  • **Names are matched by slug, never by spelling.** "Forest Entrance", "the
 *    forest entrance" and "Forest Entrance." are one room, not three prep calls
 *    and three map ghosts. `names.ts → slug` is the same matcher the deltas and
 *    `equip.ts` use; the leading article comes off on top of it, because a
 *    narrator writes "the Stile" one beat and "Stile" the next.
 *  • **Coordinates are internal, like `GameState.minutes`.** No model — narrator
 *    or prep — ever sees or writes a number. Prep emits room names and exits;
 *    the client places every room itself, by a deterministic spiral out from the
 *    room it was entered from. Collisions are impossible by construction, and a
 *    graph no grid embedding could honour still renders: exits are drawn as
 *    rules between cells wherever they sit, and adjacency is never promised.
 *
 * Pure + tested. Nothing here calls a model.
 */

/** Leading article, stripped before slugging so "the Stile" keys as "stile". */
const LEADING_ARTICLE = /^(?:the|a|an)\s+/i;

/**
 * A place name → its key. Article-stripped, then slugged.
 *
 * Falls back to the bare slug when stripping would leave nothing, so a room
 * genuinely called "The" (or "A") still gets a key instead of vanishing.
 */
export function placeKey(name: string): string {
  const trimmed = (name ?? "").trim();
  const stripped = trimmed.replace(LEADING_ARTICLE, "").trim();
  return slug(stripped) || slug(trimmed);
}

/** Rooms and areas key identically; both names exist so call sites read right. */
export const roomKey = placeKey;
export const areaKeyFor = placeKey;

/* ------------------------------------------------------------------ *
 * The grids
 * ------------------------------------------------------------------ */

/**
 * How far a coordinate may sit from the origin on either axis. Bounded because
 * the player can write coordinates (saves are hand-editable, and the map is
 * meant to become draggable) and an unbounded cell would render off-canvas
 * forever.
 */
export const GRID_LIMIT = 16;

/** `x,y` — the cell key the placement spiral checks occupancy against. */
export function cellKey(c: Coord): string {
  return `${c.x},${c.y}`;
}

function clampCoord(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.min(GRID_LIMIT, Math.max(-GRID_LIMIT, Math.round(n)));
}

/** A stored coordinate onto the legal grid. Garbage lands on the origin. */
export function normalizeCoord(raw: unknown): Coord {
  const c = (raw ?? {}) as Partial<Coord>;
  return { x: clampCoord(c.x), y: clampCoord(c.y) };
}

/**
 * The first free cell walking outward from `origin`, in a deterministic square
 * spiral. Same inputs, same cell, every time — which is what lets a map be
 * rebuilt from the same room list without the shape jumping around.
 *
 * Returns the origin itself when it is free. Falls back to the origin if the
 * whole bounded grid is somehow full, since two rooms sharing a cell is a
 * cosmetic problem and a thrown error is not.
 */
export function spiralFrom(origin: Coord, taken: Set<string>): Coord {
  const start = normalizeCoord(origin);
  if (!taken.has(cellKey(start))) return start;

  // Ring by ring: right, down, left, up, each ring one longer than the last.
  let x = start.x;
  let y = start.y;
  let step = 1;
  const dirs: Coord[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];
  let d = 0;
  while (step <= GRID_LIMIT * 4) {
    for (let turn = 0; turn < 2; turn++) {
      const dir = dirs[d % dirs.length];
      for (let i = 0; i < step; i++) {
        x += dir.x;
        y += dir.y;
        if (Math.abs(x) > GRID_LIMIT || Math.abs(y) > GRID_LIMIT) continue;
        const cell = { x, y };
        if (!taken.has(cellKey(cell))) return cell;
      }
      d++;
    }
    step++;
  }
  return start;
}

/** The cells an area's rooms already occupy. */
function occupied(rooms: Record<string, RoomSlot>, except?: string): Set<string> {
  const taken = new Set<string>();
  for (const [key, room] of Object.entries(rooms)) {
    if (key === except) continue;
    taken.add(cellKey(room.coord));
  }
  return taken;
}

/* ------------------------------------------------------------------ *
 * Rooms
 * ------------------------------------------------------------------ */

/**
 * Add a room to an area by name, placed beside the room it was entered from.
 *
 * Returns the SAME card when the room is already there, so callers can
 * reference-diff — a turn that walks back into a known room allocates nothing.
 * An unlisted room is not an error: the area's room list is a seed, not a
 * fence, and the narrator inventing a place is the ordinary case.
 */
export function addRoom(area: AreaCard, name: string, fromKey?: string): AreaCard {
  const key = roomKey(name);
  if (!key || area.rooms[key]) return area;

  const from = fromKey ? area.rooms[fromKey] : undefined;
  const coord = spiralFrom(from?.coord ?? { x: 0, y: 0 }, occupied(area.rooms));
  const room: RoomSlot = {
    name: name.trim(),
    coord,
    exits: from ? [fromKey!] : [],
    visited: false,
    card: null,
  };

  const rooms: Record<string, RoomSlot> = { ...area.rooms, [key]: room };
  // The way back, immediately: an exit the player just walked is the one edge
  // the map can be certain of, and `normalizeMap` would add it anyway.
  if (from && fromKey && !from.exits.includes(key)) {
    rooms[fromKey] = { ...from, exits: [...from.exits, key] };
  }
  return { ...area, rooms };
}

/** Mark a room visited (adding it if it was never named). Reference-stable. */
export function visitRoom(area: AreaCard, name: string, fromKey?: string): AreaCard {
  const withRoom = addRoom(area, name, fromKey);
  const key = roomKey(name);
  const room = withRoom.rooms[key];
  if (!room || room.visited) return withRoom;
  return { ...withRoom, rooms: { ...withRoom.rooms, [key]: { ...room, visited: true } } };
}

/**
 * Wire up the exits a room card just named. Each one that is not already a room
 * is appended as a rumour — named, unvisited, no card — placed beside the room
 * it leads out of, and the edge is written both ways.
 *
 * This is also what makes prefetch possible: the neighbours of the room the
 * player is standing in are known the moment its card lands, so their cards can
 * be fetched at idle and be waiting when they are walked into.
 */
export function applyExits(area: AreaCard, key: string, exits: string[]): AreaCard {
  if (!area.rooms[key] || !exits.length) return area;
  let out = area;
  for (const name of exits) {
    const exitKey = roomKey(name);
    if (!exitKey || exitKey === key) continue;
    out = addRoom(out, name, key);
    const room = out.rooms[key];
    const exit = out.rooms[exitKey];
    if (!room || !exit) continue;
    if (room.exits.includes(exitKey) && exit.exits.includes(key)) continue;
    out = {
      ...out,
      rooms: {
        ...out.rooms,
        [key]: room.exits.includes(exitKey) ? room : { ...room, exits: [...room.exits, exitKey] },
        [exitKey]: exit.exits.includes(key) ? exit : { ...exit, exits: [...exit.exits, key] },
      },
    };
  }
  return out;
}

/**
 * Seed an area's room list from the names its card shipped. Names only — a
 * seeded room has no card until somebody walks into it, which is exactly what
 * makes the list cheap.
 */
export function seedRooms(area: AreaCard, names: string[]): AreaCard {
  let out = area;
  for (const name of names) out = addRoom(out, name);
  return out;
}

/* ------------------------------------------------------------------ *
 * The room → area join
 * ------------------------------------------------------------------ */

/**
 * Which area a room name belongs to, resolved ON-DEVICE off the areas' own room
 * lists — a room already appended to one, or a name the area listed and nobody
 * has walked into yet.
 *
 * This is the whole reason `LoomBlock.area` is needed only for a genuinely new
 * region: cost → front ticking rides this join, and the front economy must not
 * hang on an optional field emitted by the same weak models that drop whole
 * blocks.
 */
export function areaOfRoom(
  areas: Record<string, AreaCard>,
  location: string,
): string | null {
  const key = roomKey(location);
  if (!key) return null;
  for (const area of Object.values(areas)) {
    if (area.rooms[key]) return area.key;
  }
  return null;
}

/**
 * Where the player now stands, after a turn that may have moved them.
 *
 * Order of trust: the room list resolves it; failing that a narrator-named NEW
 * region does; failing that the player is where they were. Never null once an
 * area exists, because "unknown room → the area you were in" is the documented
 * degradation and a dropped area would silently stop the fronts.
 */
export function resolveAreaKey(
  areas: Record<string, AreaCard>,
  location: string,
  named: string | undefined,
  current: string | null | undefined,
): string | null {
  const byRoom = areaOfRoom(areas, location);
  if (byRoom) return byRoom;
  const namedKey = named ? areaKeyFor(named) : "";
  if (namedKey) return namedKey;
  return current ?? null;
}

/* ------------------------------------------------------------------ *
 * Staleness
 * ------------------------------------------------------------------ */

/**
 * An area prepped under a different arc — or under an older epoch of the one
 * running — is stale. The stamp is the PAIR: every arc instance counts epochs
 * from zero, so an area prepped under arc I at epoch 2 would read fresh again
 * the day arc II reached its own epoch 2.
 *
 * With no arc at all nothing is stale: single-scope foresight is the degenerate
 * case, not a permanently invalid one.
 */
export function areaIsStale(card: AreaCard, arc: Arc | undefined): boolean {
  if (!arc) return false;
  return card.arcId !== arc.id || card.epoch !== arc.epoch;
}

/** A room card prepped under an older version of its area is stale. */
export function roomIsStale(area: AreaCard, room: RoomSlot | undefined): boolean {
  if (!room?.card) return false;
  return room.card.version !== area.version;
}

/* ------------------------------------------------------------------ *
 * Reading the current scene
 * ------------------------------------------------------------------ */

/** The area the game's `areaKey` points at, if it is prepped. */
export function currentArea(game: GameState): AreaCard | undefined {
  const areas = game.areas ?? {};
  return game.areaKey ? areas[game.areaKey] : undefined;
}

/** The room slot for `game.location` inside the current area. */
export function currentRoom(game: GameState): RoomSlot | undefined {
  const area = currentArea(game);
  if (!area) return undefined;
  return area.rooms[roomKey(game.location)];
}

/* ------------------------------------------------------------------ *
 * Reading a card out loud
 *
 * The three card READERS live here rather than beside the calls that write
 * them (`areaPrep.ts`, `roomPrep.ts`) for one structural reason: those two
 * modules build side calls, so they import `prompt.ts` — and prompt assembly
 * has to read a card, which would be a cycle. This module imports nothing but
 * `names.ts`, so everybody can read it.
 * ------------------------------------------------------------------ */

/**
 * The `AREA` tier of the prep block. Blank when the card says nothing, so an
 * unprepped region costs no tokens.
 */
export function formatAreaBlock(card: AreaCard | undefined): string {
  if (!card) return "";
  const lines = [`AREA — ${card.name}`];
  if (card.texture) lines.push(`  ${card.texture}`);
  for (const threat of card.threats) lines.push(`  standing: ${threat}`);
  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * The `ROOM` tier. The outcomes are deliberately NOT here — only the band that
 * actually rolled is ever shown, and it rides the OUTCOME block down in the
 * turn's own facts.
 */
export function formatRoomBlock(
  area: AreaCard | undefined,
  room: RoomSlot | undefined,
): string {
  const card = room?.card;
  if (!room || !card) return "";
  const lines = [`ROOM — ${room.name}`];
  if (card.danger) lines.push(`  ${card.danger}`);
  if (card.threats.length) lines.push(`  threats: ${card.threats.join(" · ")}`);
  if (card.hooks.length) lines.push(`  here to want: ${card.hooks.join(" · ")}`);
  // Exits are stored as room KEYS; the narrator gets the display spelling, which
  // is what it has to write into the prose.
  const ways = room.exits.map((key) => area?.rooms[key]?.name ?? "").filter(Boolean);
  if (ways.length) lines.push(`  ways out: ${ways.join(" · ")}`);
  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * The prepared line for the band that rolled, or "". The two branches that did
 * NOT roll are never read, so there is nothing for the narrator to hedge
 * toward and nothing to leak.
 */
export function preparedOutcome(
  room: RoomSlot | undefined,
  outcome: TurnOutcome | null | undefined,
): string {
  if (!room?.card || !outcome) return "";
  return room.card.outcomes[outcome]?.trim() ?? "";
}

/* ------------------------------------------------------------------ *
 * normalizeMap — sanitize at READ
 * ------------------------------------------------------------------ */

/**
 * Sanitize the gazetteer's GEOMETRY at read time, in the `normalizeDice`
 * stance. It runs over what the PLAYER can produce — a hand-edited save, and
 * eventually a dragged room — so it is defensive about everything:
 *
 *  - coordinates clamped to the bounded grid;
 *  - two rooms on one cell → the later one is pushed by the same spiral, so the
 *    map can never draw one room on top of another;
 *  - exits naming an unknown room dropped, and every surviving edge made
 *    symmetric — a one-way exit is always a typo, never a design.
 *
 * Reference-stable: a gazetteer that was already clean comes back untouched, so
 * hydrating an ordinary save allocates nothing and reversal's reference diffing
 * keeps working.
 */
export function normalizeMap(
  areas: Record<string, AreaCard> | undefined,
): Record<string, AreaCard> {
  if (!areas) return {};
  let changed = false;
  const out: Record<string, AreaCard> = {};
  const areaCells = new Set<string>();

  for (const [key, card] of Object.entries(areas)) {
    if (!card || typeof card !== "object") {
      changed = true;
      continue;
    }
    const coord = spiralFrom(normalizeCoord(card.coord), areaCells);
    areaCells.add(cellKey(coord));

    const rooms = normalizeRooms(card.rooms ?? {});
    const neighbours = (Array.isArray(card.neighbours) ? card.neighbours : []).filter(
      (n) => typeof n === "string" && n !== key && Boolean(areas[n]),
    );

    const sameCoord = coord.x === card.coord?.x && coord.y === card.coord?.y;
    const sameNeighbours =
      neighbours.length === (card.neighbours?.length ?? 0) &&
      neighbours.every((n, i) => n === card.neighbours?.[i]);

    if (rooms === card.rooms && sameCoord && sameNeighbours && card.key === key) {
      out[key] = card;
      continue;
    }
    changed = true;
    out[key] = { ...card, key, coord, neighbours, rooms };
  }

  return changed || Object.keys(out).length !== Object.keys(areas).length ? out : areas;
}

/** One area's rooms: placed, de-collided, and with symmetric exits. */
function normalizeRooms(rooms: Record<string, RoomSlot>): Record<string, RoomSlot> {
  const keys = Object.keys(rooms);
  const cells = new Set<string>();
  const placed: Record<string, RoomSlot> = {};
  let changed = false;

  for (const key of keys) {
    const room = rooms[key];
    if (!room || typeof room !== "object") {
      changed = true;
      continue;
    }
    const coord = spiralFrom(normalizeCoord(room.coord), cells);
    cells.add(cellKey(coord));
    const moved = coord.x !== room.coord?.x || coord.y !== room.coord?.y;
    if (moved) changed = true;
    placed[key] = moved ? { ...room, coord } : room;
  }

  // Exits: drop the ones naming nobody, then mirror what is left.
  const exits = new Map<string, Set<string>>();
  for (const key of Object.keys(placed)) exits.set(key, new Set());
  for (const [key, room] of Object.entries(placed)) {
    for (const exit of Array.isArray(room.exits) ? room.exits : []) {
      if (typeof exit !== "string" || exit === key || !placed[exit]) continue;
      exits.get(key)!.add(exit);
      exits.get(exit)!.add(key);
    }
  }

  const out: Record<string, RoomSlot> = {};
  for (const [key, room] of Object.entries(placed)) {
    const next = [...exits.get(key)!];
    const same =
      next.length === (room.exits?.length ?? 0) &&
      next.every((e) => room.exits.includes(e));
    if (same) {
      out[key] = room;
      continue;
    }
    changed = true;
    out[key] = { ...room, exits: next };
  }

  return changed ? out : rooms;
}
