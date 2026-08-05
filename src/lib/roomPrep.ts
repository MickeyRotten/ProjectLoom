import type {
  AreaCard,
  GameState,
  Message,
  PartyMember,
  RoomCard,
  RoomSlot,
  Settings,
  StoryPromise,
} from "../types";
import { type ChatMessage, formatScenarioBlock } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { roomIsStale, roomKey } from "./gazetteer";
import { prepLine, prepLines } from "./areaPrep";
import { formatWorldNotesBlock, matchWorldNotes } from "./worldNotes";

/**
 * Room prep — one call per room, ever, until its area is re-prepped.
 *
 * A room card is what this place IS: the space, the threats and what sets them
 * off, what is here to want, and the ways out. It carries no prepared outcome
 * bands — the dice band the narrator rolls is `stakes.ts`'s business alone, and
 * a line written in advance for a place cannot know what was attempted in it.
 *
 * Pure + tested.
 */

/** The thing, and what sets it off. Three at most. */
export const ROOM_MAX_THREATS = 3;

/** What is here to want. Two at most. */
export const ROOM_MAX_HOOKS = 2;

/** The ways out, by name. */
export const ROOM_MAX_EXITS = 4;

/** Same reasoning as `AREA_PREP_TEMPERATURE`; the room is the more concrete half. */
export const ROOM_PREP_TEMPERATURE = 0.8;

/**
 * Does this room need a call?
 *
 * Three reasons, and the third is the turn ceiling: room granularity absorbs
 * most of what a ceiling used to cover, but a thirty-turn tavern conversation
 * is one room and its card goes stale in place.
 */
export function roomChanged(
  area: AreaCard | undefined,
  room: RoomSlot | undefined,
  turn: number,
  boundaryTurns: number,
): boolean {
  if (!area) return false;
  if (!room?.card) return true;
  if (roomIsStale(area, room)) return true;
  return boundaryTurns > 0 && turn - room.card.openedTurn >= boundaryTurns;
}

/** What a model reply becomes. `version`/`openedTurn` are the client's stamps. */
export interface ParsedRoomCard {
  danger: string;
  threats: string[];
  hooks: string[];
  exits: string[];
}

/**
 * Pull a room card out of a model reply. A partial card is still worth keeping
 * — the threats and the exits are useful on their own — but a reply with
 * nothing usable anywhere returns null.
 */
export function parseRoomCard(raw: string): ParsedRoomCard | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Record<string, unknown>>(json);
  if (!parsed) return null;

  const danger = prepLine(parsed.danger);
  const threats = prepLines(parsed.threats, ROOM_MAX_THREATS);
  const hooks = prepLines(parsed.hooks, ROOM_MAX_HOOKS);
  const exits = prepLines(parsed.exits, ROOM_MAX_EXITS);

  const empty = !danger && !threats.length && !hooks.length && !exits.length;
  return empty ? null : { danger, threats, hooks, exits };
}

/** Sanitize a stored room card at READ. */
export function normalizeRoomCard(raw: Partial<RoomCard> | null | undefined): RoomCard | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    version: Number.isFinite(raw.version) ? Math.max(1, Math.round(raw.version as number)) : 1,
    openedTurn: Number.isFinite(raw.openedTurn) ? Math.round(raw.openedTurn as number) : 0,
    danger: prepLine(raw.danger),
    threats: prepLines(raw.threats, ROOM_MAX_THREATS),
    hooks: prepLines(raw.hooks, ROOM_MAX_HOOKS),
  };
}

/** The card as it lands: the model's material plus the client's version stamp. */
export function stampRoomCard(
  parsed: ParsedRoomCard,
  area: AreaCard,
  turn: number,
): RoomCard {
  return {
    version: area.version,
    openedTurn: turn,
    danger: parsed.danger,
    threats: parsed.threats,
    hooks: parsed.hooks,
  };
}

/**
 * The text the World Notes matcher scans: this place's name, the region it sits
 * in, and whatever the player typed into the ✦ modal's Guidance.
 *
 * Room prep read no notes at all before this — the one prep call in the chain
 * that did not, so a lorebook entry about the Drowned Stair reached the region
 * that contains it and never the stair itself.
 */
export function roomScanText(name: string, area: AreaCard, hint?: string): string {
  return [name, area.name, hint ?? ""].filter((t) => t && t.trim()).join("\n");
}

/**
 * The messages for one room-prep call: the area it sits in (shown, and not to
 * be restated), the last two beats, the outstanding promises, the party's
 * flaws — which are what makes a threat land on somebody in particular rather
 * than on the scenery — and the lore this place's name pulls in.
 *
 * `hint` is the ✦ button's free text: last in the list so it outranks the room
 * as it stands, and folded into the note scan on the way.
 */
export function buildRoomMessages(
  settings: Settings,
  game: GameState,
  name: string,
  area: AreaCard,
  party: PartyMember[] = [],
  promises: StoryPromise[] = [],
  hint = "",
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const guidance = hint.trim();

  messages.push({
    role: "system",
    content: [
      "SCENE PREP — you are preparing ONE place in a text adventure before the player acts in it. Private notes, never narration.",
      "Reply with a single JSON object and nothing else — no prose, no commentary, no code fences:",
      '{ "danger": "…", "threats": ["…"], "hooks": ["…"], "exits": ["…"] }',
      "",
      "THE FIELDS",
      `- "danger" is what this space IS, in one line — the shape of it, the sightlines, what it does to somebody standing in it.`,
      `- "threats" is at most ${ROOM_MAX_THREATS}: the thing, AND what sets it off.`,
      `- "hooks" is at most ${ROOM_MAX_HOOKS}: what is here to want.`,
      `- "exits" is the ways out, BY NAME — the concrete geography a scene contradicts itself about three beats later.`,
      "- No numbers anywhere, and nothing the player has already been told.",
      settings.scenePrepInstructions.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const scenario = formatScenarioBlock(game.scenario);
  if (scenario) messages.push({ role: "system", content: scenario });

  messages.push({
    role: "system",
    content: [
      `THE REGION — ${area.name}. Do NOT restate any of it; write what is true in THIS place because of it.`,
      area.texture,
      ...area.threats.map((t) => `standing: ${t}`),
      area.rooms && Object.keys(area.rooms).length
        ? `Other places in the region: ${Object.values(area.rooms)
            .map((r) => r.name)
            .filter((n) => roomKey(n) !== roomKey(name))
            .join(" · ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const recent = lastBeats(game.messages, 2);
  if (recent) {
    messages.push({
      role: "system",
      content: `THE LAST BEATS — where the player is coming from.\n\n${recent}`,
    });
  }

  const flaws = party.filter((m) => m.flaws.trim());
  if (flaws.length) {
    messages.push({
      role: "system",
      content: `WHO IS HERE, AND WHAT THEY ARE BAD AT — a threat lands best on somebody in particular.\n${flaws
        .map((m) => `- ${m.name}: ${m.flaws.trim()}`)
        .join("\n")}`,
    });
  }

  if (promises.length) {
    messages.push({
      role: "system",
      content: `OUTSTANDING PROMISES — the story has committed to these and not paid them off. This is a place they could land.\n${promises
        .map((p) => `- ${p.text}`)
        .join("\n")}`,
    });
  }

  const notes = formatWorldNotesBlock(
    matchWorldNotes(game.worldNotes, roomScanText(name, area, guidance)),
  );
  if (notes) messages.push({ role: "system", content: notes });

  // Last, so it outranks the place as it currently stands.
  if (guidance) {
    messages.push({
      role: "system",
      content: `PLAYER GUIDANCE — what the player wants this place to be. Follow it even where it cuts against what is written above.\n${guidance}`,
    });
  }

  messages.push({
    role: "user",
    content: `Prepare the place: ${name.trim()}. Emit the JSON object now.`,
  });

  return messages;
}

/** The last `turns` beats, as the prep call reads them. */
function lastBeats(messages: Message[], turns: number): string {
  return messages
    .slice(-turns * 2)
    .map((m) => `${m.role === "player" ? "PLAYER" : "NARRATOR"}: ${m.content}`)
    .join("\n\n");
}

/**
 * The card is READ in `gazetteer.ts → formatRoomBlock`. Same reason as
 * `areaPrep.ts`: this module imports `prompt.ts` to build its call, so prompt
 * assembly cannot import back.
 */
