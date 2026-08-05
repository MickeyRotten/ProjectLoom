import type {
  Arc,
  AreaCard,
  GameState,
  LoomBlock,
  Reckoning,
  Settings,
  TurnOutcome,
} from "../types";
import {
  bumpEpoch,
  interludeOver,
  openArc,
  handOff,
  hasArc,
  normalizeArcs,
  normalizeTemplate,
  resumeArc,
  runningArc,
  toInterlude,
} from "./arc";
import { restFronts, tickFront, tickNeglect } from "./fronts";
import { agePromises, applyPromises, normalizePromises } from "./promises";
import { normalizeMap, resolveAreaKey, visitRoom } from "./gazetteer";
import { normalizeAreaCard } from "./areaPrep";
import { normalizeRoomCard } from "./roomPrep";

/**
 * Reckon — what the CLIENT does after a turn's block has applied. No call, no
 * network, and folded into the same `nextGame` the deltas produced, so it rides
 * the same save and the same `captureReversal` — exactly how a `condition` rides
 * the roster.
 *
 * Everything here is arithmetic and bookkeeping the model is never asked about:
 *
 *  - the room→area join, resolved on-device off the areas' own room lists;
 *  - a COST rolled in a room whose area serves a front ticks that front (and a
 *    MIXED one, if the table wants it);
 *  - **neglect** — a front untouched for `frontNeglectDays` in-game days ticks
 *    on its own, which is what makes the world move while the player does
 *    something else;
 *  - a front reaching the end of its clock FIRES, and if it was the spine the
 *    arc goes to interlude;
 *  - promises plant, close and age.
 *
 * The result carries a `Reckoning` alongside the new slices, because front ticks
 * and promise plants are client-computed and therefore do NOT belong in
 * `Message.appliedDeltas` — that array is a record of what the model said.
 *
 * Pure + tested.
 */

export interface ReckonInput {
  game: GameState;
  settings: Settings;
  /** The turn that just resolved. */
  turn: number;
  /** The day AFTER this turn's duration (`clock.ts`). */
  day: number;
  /** Where the scene ended up, after `applyDeltas`. */
  location: string;
  /** The reconciled block — read for `area` and `promises`. */
  block: LoomBlock | null;
  /** The band this turn rolled, if any. */
  outcome: TurnOutcome | null;
}

export interface ReckonResult {
  /**
   * The three slices, typed OPTIONAL exactly as `GameState` holds them. A game
   * with no Foresight data in it must come back with the fields still absent
   * rather than with fresh empty arrays: `captureReversal` reference-diffs, so
   * handing back `[]` where the save held `undefined` would snapshot two empty
   * slices onto every turn of every game forever.
   */
  arcs: GameState["arcs"];
  areas: GameState["areas"];
  areaKey: string | null;
  promises: GameState["promises"];
  /** What the client did, for the beat's chips. Absent when it did nothing. */
  reckoning?: Reckoning;
}

/**
 * Run the reckon. Reference-stable throughout: a quiet turn in a game with no
 * arcs and no promises returns the same four references it was handed, so
 * `captureReversal`'s reference diffing keeps recording nothing.
 */
export function reckonTurn(input: ReckonInput): ReckonResult {
  const { game, settings, turn, day, location, block, outcome } = input;

  const arcs = game.arcs ?? [];
  const areasIn = game.areas ?? {};
  const promisesIn = game.promises ?? [];

  // 1. Where are we? The room list resolves it; `block.area` only ever
  //    introduces a genuinely new region.
  const areaKey = resolveAreaKey(areasIn, location, block?.area, game.areaKey);
  let areas = areasIn;
  if (areaKey) {
    const existing = areas[areaKey];
    // A region the narrator named but nothing has prepped is still a place the
    // player is standing in: it gets a stub so the room can be recorded, and the
    // prep call fills it in afterwards.
    const card =
      existing ??
      normalizeAreaCard({ name: block?.area?.trim() || location.trim() }, areaKey);
    const visited = visitRoom(card, location);
    if (visited !== existing) areas = { ...areas, [areaKey]: visited };
  }

  // 2. Promises: plant what the prose committed to, close what it paid off,
  //    then drop the ones nobody is ever going to come back to.
  const planted = applyPromises(promisesIn, block?.promises, turn);
  const promises = agePromises(planted, turn, settings.promiseTurns);

  // 3. The clocks. An arc in interlude suspends every one of them — that IS the
  //    interlude, and nothing looming is the whole point of it.
  const arc = runningArc(arcs);
  const reckoning: Reckoning = {};
  let nextArcs = arcs;

  if (arc && arc.status === "running") {
    // 3a. Retire what already arrived. A front reaching the end of its clock
    //     goes `fired`, and the NEXT turn is the one that carries its mandatory
    //     arrival block — so by the time we are back here that beat is written
    //     and the front is spent. Retiring it here is also what makes the block
    //     fire exactly once instead of on every turn from now on.
    const spent = arc.fronts.filter((f) => f.status === "fired");
    let fronts = spent.length
      ? arc.fronts.map((f) => (f.status === "fired" ? { ...f, status: "retired" as const } : f))
      : arc.fronts;
    // The spine's arrival is what ends the story — but only now, a beat after it
    // landed, so the arrival got narrated instead of being swallowed by an
    // interlude that starts by saying nothing is looming.
    const spineSpent = spent.some((f) => f.id === arc.spine);

    // 3b. This turn's tick, if the band earned one and this region serves a front.
    const areaFront = areaKey ? areas[areaKey]?.front : undefined;
    const ticksNow =
      (outcome === "cost" && settings.costTicksFront) ||
      (outcome === "mixed" && settings.mixedTicksFront);

    const ticked: string[] = [];
    const fired: string[] = [];

    if (ticksNow && areaFront) {
      const result = tickFront(fronts, areaFront, day);
      fronts = result.fronts;
      ticked.push(...result.ticked);
      fired.push(...result.fired);
    }

    // 3c. Neglect — the pass that makes the world move while the player is
    //     doing something else.
    const neglect = tickNeglect(fronts, day, settings.frontNeglectDays);
    fronts = neglect.fronts;
    ticked.push(...neglect.ticked);
    fired.push(...neglect.fired);

    if (fronts !== arc.fronts) {
      let next: Arc = { ...arc, fronts };
      // A front firing or retiring makes every area prepped under this arc
      // describe a world that has moved, so the epoch moves with it.
      if (fired.length || spent.length) next = bumpEpoch(next);
      if (spineSpent) next = toInterlude(next, turn);
      nextArcs = arcs.map((a) => (a.id === arc.id ? next : a));
      if (ticked.length) reckoning.frontTicked = ticked[0];
      if (fired.length) reckoning.frontFired = fired[0];
    }
  } else if (arc && arc.status === "interlude" && interludeOver(arc, turn, settings.interludeTurns)) {
    // The interlude has run its course. A staged handoff applies itself here —
    // co-authoring is an offer, and an unvisited Arc screen must never dead-end
    // the campaign into arcless play.
    nextArcs = closeInterlude(arcs, arc, turn, day);
  }

  const plantedNow = (block?.promises ?? [])
    .filter((p) => p.op === "add")
    .map((p) => p.text.trim())
    .filter(Boolean);
  if (plantedNow.length && promises !== promisesIn) reckoning.promisesPlanted = plantedNow;

  return {
    // Each slice comes back exactly as it went in when nothing touched it —
    // including "absent", which is what every save written before Foresight
    // holds and what a game that never uses it should keep holding.
    arcs: nextArcs === arcs ? game.arcs : nextArcs,
    areas: areas === areasIn ? game.areas : areas,
    areaKey,
    promises: promises === promisesIn ? game.promises : promises,
    ...(Object.keys(reckoning).length ? { reckoning } : {}),
  };
}

/**
 * End an interlude: open the staged arc if there is one, otherwise resume the
 * one that was running with its clocks re-anchored to today. Never leaves the
 * campaign without an arc.
 */
export function closeInterlude(arcs: Arc[], arc: Arc, turn: number, day: number): Arc[] {
  if (arc.staged && hasArc(arc.staged)) {
    return handOff(arcs, arc.staged, `arc-${turn}`, turn, day);
  }
  const resumed = resumeArc(arc, day);
  return arcs.map((a) => (a.id === arc.id ? resumed : a));
}

/**
 * Open an arc from the scenario's template — New Adventure, and the first turn
 * of a game whose scenario gained one. Returns the same list when there is
 * nothing to open or an arc is already running.
 */
export function seedArcs(game: GameState, turn: number): Arc[] {
  const arcs = game.arcs ?? [];
  if (runningArc(arcs)) return arcs;
  const template = game.scenario.arc;
  if (!template || !hasArc(normalizeTemplate(template))) return arcs;
  return [...arcs, openArc(template, `arc-${arcs.length + 1}`, turn, game.day)];
}

/**
 * Sanitize every Foresight slice of a stored game at READ, in the
 * `normalizeDice` stance. Reference-stable — a game with no Foresight data
 * comes back with the same object, so hydrating an ordinary save allocates
 * nothing.
 */
export function normalizeForesight(game: GameState): GameState {
  const arcs = game.arcs ? normalizeArcs(game.arcs) : undefined;
  const promises = game.promises ? normalizePromises(game.promises) : undefined;
  const areas = game.areas ? normalizeMap(normalizeCards(game.areas)) : undefined;

  if (arcs === game.arcs && promises === game.promises && areas === game.areas) return game;
  return {
    ...game,
    ...(arcs ? { arcs } : {}),
    ...(promises ? { promises } : {}),
    ...(areas ? { areas } : {}),
  };
}

/** Every stored card and room card through its own normalizer. */
function normalizeCards(areas: Record<string, AreaCard>): Record<string, AreaCard> {
  const out: Record<string, AreaCard> = {};
  for (const [key, card] of Object.entries(areas)) {
    const clean = normalizeAreaCard(card ?? {}, key);
    const rooms = { ...clean.rooms };
    for (const [roomKey, room] of Object.entries(rooms)) {
      rooms[roomKey] = { ...room, card: normalizeRoomCard(room?.card) };
    }
    out[key] = { ...clean, rooms };
  }
  return out;
}

/**
 * Move every open front's clock reference to today WITHOUT ticking — what the
 * store calls when foresight is switched back on, or when a game is loaded
 * after a long real-world gap in a way that would otherwise arrive as a neglect
 * burst on the first turn.
 */
export function anchorClocks(arcs: Arc[], day: number): Arc[] {
  let changed = false;
  const out = arcs.map((arc) => {
    if (arc.status === "done") return arc;
    const fronts = restFronts(arc.fronts, day);
    if (fronts === arc.fronts) return arc;
    changed = true;
    return { ...arc, fronts };
  });
  return changed ? out : arcs;
}
