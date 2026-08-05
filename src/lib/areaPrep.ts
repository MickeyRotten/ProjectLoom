import type { Arc, AreaCard, GameState, Settings, StoryPromise } from "../types";
import { type ChatMessage, formatScenarioBlock } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { areaIsStale, normalizeCoord } from "./gazetteer";
import { formatFrontLines, liveFronts } from "./fronts";
import { formatWorldNotesBlock, matchWorldNotes } from "./worldNotes";

/**
 * Area prep — one call per region, ever, until the arc under it moves.
 *
 * An area card is the region's pressure: what it is like, what applies anywhere
 * in it, and **which front it serves**. Rooms inherit that front rather than
 * each picking one and drifting.
 *
 * It also ships a list of **room names** — names only, no content. Cheap, and it
 * buys four things: the narrator stops renaming the same place, room prep gets a
 * hint, the map has a skeleton before anything is walked, and an unlisted room
 * still works, because a list is a seed and not a fence. A named room nobody
 * visits is a rumour, and rumours are hooks — so unvisited names survive a
 * re-prep.
 *
 * Pure + tested: assembly, parsing and sanitizing live here; only the store
 * touches the network.
 */

/** What applies ANYWHERE in a region, capped. Beyond two it is not standing, it is weather. */
export const AREA_MAX_THREATS = 2;

/** Room names one card may seed. Capped so rumours cannot accumulate forever. */
export const AREA_MAX_ROOMS = 8;

/** Hard cap on one written line. The `JOURNAL_MAX_LINE_CHARS` mould. */
export const PREP_MAX_LINE_CHARS = 140;

/**
 * Warmer than the journal's 0.3 (this is invention) and cooler than a ✦ field's
 * 0.9 (it has to sit inside a world somebody else already wrote).
 */
export const AREA_PREP_TEMPERATURE = 0.8;

/** Does this region need a call — never prepped, or prepped under an older arc? */
export function areaChanged(
  game: GameState,
  key: string,
  arc: Arc | undefined,
): boolean {
  const card = (game.areas ?? {})[key];
  if (!card) return true;
  return areaIsStale(card, arc);
}

/** Trim and cap one written line. */
export function prepLine(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, PREP_MAX_LINE_CHARS) : "";
}

/** Trim, cap and de-blank a written list. */
export function prepLines(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(prepLine).filter(Boolean).slice(0, limit);
}

/**
 * What a model reply becomes, before it is stamped. Deliberately NOT an
 * `AreaCard`: the arc id, epoch, version and every coordinate are the client's,
 * and a parse that could produce them would be a channel for the model to write
 * them.
 */
export interface ParsedAreaCard {
  texture: string;
  threats: string[];
  rooms: string[];
  front?: string;
}

/**
 * Pull an area card out of a model reply. Tolerant about the wrapper, strict
 * about the contents; a reply with nothing usable in it returns null, and the
 * caller leaves the region unprepped rather than caching an empty card.
 */
export function parseAreaCard(raw: string, arc: Arc | undefined): ParsedAreaCard | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return null;

  const texture = prepLine(parsed.texture);
  const threats = prepLines(parsed.threats, AREA_MAX_THREATS);
  const rooms = prepLines(parsed.rooms, AREA_MAX_ROOMS);
  if (!texture && !threats.length && !rooms.length) return null;

  // A front id naming nothing in the running arc is dropped rather than kept:
  // rooms inherit this, and an area serving a front that does not exist would
  // quietly stop every cost outcome from ticking anything.
  const named = typeof parsed.front === "string" ? parsed.front.trim() : "";
  const front = liveFronts(arc).find((f) => f.id === named || f.label === named)?.id;

  return { texture, threats, rooms, ...(front ? { front } : {}) };
}

/**
 * Sanitize a stored area card at READ. Everything the client owns is pinned
 * here — coordinates onto the grid, caps onto the written lines — so a
 * hand-edited save degrades instead of reaching the prompt intact.
 */
export function normalizeAreaCard(raw: Partial<AreaCard>, key: string): AreaCard {
  return {
    key,
    name: prepLine(raw.name) || key,
    arcId: typeof raw.arcId === "string" ? raw.arcId : "",
    epoch: Number.isFinite(raw.epoch) ? Math.max(0, Math.round(raw.epoch as number)) : 0,
    version: Number.isFinite(raw.version) ? Math.max(1, Math.round(raw.version as number)) : 1,
    coord: normalizeCoord(raw.coord),
    neighbours: Array.isArray(raw.neighbours)
      ? raw.neighbours.filter((n): n is string => typeof n === "string")
      : [],
    texture: prepLine(raw.texture),
    threats: prepLines(raw.threats, AREA_MAX_THREATS),
    ...(typeof raw.front === "string" && raw.front ? { front: raw.front } : {}),
    rooms: raw.rooms && typeof raw.rooms === "object" ? raw.rooms : {},
  };
}

/**
 * The card as it lands in the gazetteer: the model's material, plus the stamps
 * only the client may write.
 *
 * A re-prep bumps `version`, which is what marks the rooms cached under it
 * stale, and KEEPS the rooms themselves — including the never-visited ones. A
 * rumour is a hook; deleting it would throw away the one thing an unvisited
 * room is for.
 */
export function stampAreaCard(
  parsed: ParsedAreaCard,
  key: string,
  name: string,
  arc: Arc | undefined,
  previous: AreaCard | undefined,
): AreaCard {
  return normalizeAreaCard(
    {
      ...previous,
      name: previous?.name || name,
      arcId: arc?.id ?? "",
      epoch: arc?.epoch ?? 0,
      version: (previous?.version ?? 0) + 1,
      texture: parsed.texture,
      threats: parsed.threats,
      ...(parsed.front ? { front: parsed.front } : {}),
      rooms: previous?.rooms ?? {},
    },
    key,
  );
}

/**
 * The messages for one area-prep call: the arc it serves, the scenario, the
 * lore this region's own name pulls in, and the promises still outstanding.
 *
 * The arc is shown and the model is told **not to restate it**. Three tiers is
 * where "every fact is stated once" goes to die, so it is enforced at AUTHORING
 * rather than at display — caps do the rest.
 */
export function buildAreaMessages(
  settings: Settings,
  game: GameState,
  name: string,
  arc: Arc | undefined,
  promises: StoryPromise[] = [],
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  messages.push({
    role: "system",
    content: [
      "AREA PREP — you are preparing a REGION of a text adventure before the player explores it. This is your own private notes, not narration.",
      "Reply with a single JSON object and nothing else — no prose, no commentary, no code fences:",
      '{ "texture": "…", "threats": ["…"], "rooms": ["…", "…"], "front": "<front id or omit>" }',
      "",
      "THE FIELDS",
      `- "texture" is what this region IS, in one line: the look, the weather, who moves through it, what state it is in.`,
      `- "threats" is what applies ANYWHERE in the region — at most ${AREA_MAX_THREATS}. Not events; standing conditions with teeth.`,
      `- "rooms" is up to ${AREA_MAX_ROOMS} PLACE NAMES inside this region. Names only, no description — they are what stops the same place being renamed every time the player walks back into it.`,
      `- "front" is the id of the arc front this region serves, or omit it when the region is off to one side of the story.`,
      "- Write nothing the player has already been told, and no numbers: no distances, no counts, no times, no coordinates.",
      settings.areaPrepInstructions.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const scenario = formatScenarioBlock(game.scenario);
  if (scenario) messages.push({ role: "system", content: scenario });

  if (arc) {
    const fronts = liveFronts(arc);
    messages.push({
      role: "system",
      content: [
        "THE ARC — the story this region sits inside. Do NOT restate any of it in your fields; write what is TRUE HERE because of it.",
        arc.question.trim(),
        ...formatFrontLines(fronts),
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  const notes = formatWorldNotesBlock(matchWorldNotes(game.worldNotes, name));
  if (notes) messages.push({ role: "system", content: notes });

  if (promises.length) {
    messages.push({
      role: "system",
      content: `OUTSTANDING PROMISES — things the story has committed to and not yet paid off. This region may be where they land.\n${promises
        .map((p) => `- ${p.text}`)
        .join("\n")}`,
    });
  }

  messages.push({
    role: "user",
    content: `Prepare the region: ${name.trim()}. Emit the JSON object now.`,
  });

  return messages;
}

/**
 * The card is READ in `gazetteer.ts → formatAreaBlock`, not here: this module
 * builds a side call, so it imports `prompt.ts`, and prompt assembly reading a
 * card back through it would be a cycle.
 */
