import type {
  Arc,
  ArcTemplate,
  Character,
  Front,
  FrontTemplate,
  GameState,
  Settings,
} from "../types";
import { type ChatMessage, formatScenarioBlock, formatJournalBlock } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import {
  MAX_CLOCK,
  clockFace,
  nextStep,
  normalizeFront,
  openFronts,
  restFronts,
} from "./fronts";
import { formatIdentity } from "./roster";

/**
 * The arc — the widest of Foresight's three scopes, and the only one with a
 * lifespan measured in sessions.
 *
 * Split the way this project already splits people (see **Characters ⟂ Party**):
 * `Scenario.arc` is the AUTHORED template, frozen and carried across a New
 * Adventure by the scenario import tick; `GameState.arcs` holds the INSTANCES —
 * ticks, status, what actually happened — as a list that is appended to and
 * never replaced, so a finished arc is campaign history rather than a deletion.
 *
 * **Completion is client-owned and deterministic.** The arc names one front as
 * its spine; the others are texture. When the spine fires, the arc resolves. The
 * model never declares a story over, for the same reason it never ticks a clock.
 *
 * Pure + tested; only the store touches the network.
 */

/** How many fronts one arc may carry. Beyond this nothing is looming, it is weather. */
export const MAX_FRONTS = 4;

/**
 * Cooler than the authoring calls (`generateField.ts` runs at 0.9) and warmer
 * than the journal's 0.3. A handoff invents a story, so it cannot be cold; it
 * also has to stay inside a campaign somebody else has been writing for hours.
 */
export const ARC_TEMPERATURE = 0.7;

/* ------------------------------------------------------------------ *
 * Reading and sanitizing
 * ------------------------------------------------------------------ */

/** One arc onto the shape the app can spend, sanitized at READ. */
export function normalizeArc(raw: Partial<Arc> | undefined, index = 0): Arc {
  const fronts = (Array.isArray(raw?.fronts) ? raw!.fronts : [])
    .slice(0, MAX_FRONTS)
    .map((f, i) => normalizeFront(f ?? {}, i));

  const status: Arc["status"] =
    raw?.status === "interlude" || raw?.status === "done" ? raw.status : "running";

  // A spine naming no front would make the arc uncompletable, so it falls back
  // to the first front — an arc that can never end is worse than one that ends
  // on the wrong beat.
  const spine =
    fronts.find((f) => f.id === raw?.spine)?.id ?? fronts[0]?.id ?? "";

  return {
    id: (raw?.id ?? "").trim() || `arc-${index + 1}`,
    question: (raw?.question ?? "").trim(),
    spine,
    fronts,
    epoch: Number.isFinite(raw?.epoch) ? Math.max(0, Math.round(raw!.epoch as number)) : 0,
    status,
    areas: (Array.isArray(raw?.areas) ? raw!.areas : []).filter(
      (a): a is string => typeof a === "string" && Boolean(a),
    ),
    openedTurn: Number.isFinite(raw?.openedTurn) ? Math.round(raw!.openedTurn as number) : 0,
    ...(Number.isFinite(raw?.interludeFrom)
      ? { interludeFrom: Math.round(raw!.interludeFrom as number) }
      : {}),
    ...(raw?.staged ? { staged: normalizeTemplate(raw.staged) } : {}),
  };
}

/** Every stored arc, sanitized. Reference-stable when nothing had to change. */
export function normalizeArcs(raw: unknown): Arc[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a, i) => normalizeArc(a as Partial<Arc>, i));
}

/** An authored template onto a shape `openArc` can instantiate. */
export function normalizeTemplate(raw: Partial<ArcTemplate> | undefined): ArcTemplate {
  const fronts: FrontTemplate[] = (Array.isArray(raw?.fronts) ? raw!.fronts : [])
    .slice(0, MAX_FRONTS)
    .map((f, i) => {
      const front = normalizeFront((f ?? {}) as Partial<Front>, i);
      return { id: front.id, label: front.label, steps: front.steps };
    });
  return {
    question: (raw?.question ?? "").trim(),
    fronts,
    spine: fronts.find((f) => f.id === raw?.spine)?.id ?? fronts[0]?.id ?? "",
  };
}

/** The arc the story is currently inside — running or in interlude. */
export function runningArc(arcs: Arc[] | undefined): Arc | undefined {
  return (arcs ?? []).find((a) => a.status !== "done");
}

/** Does this template say anything at all? A blank one is not worth opening. */
export function hasArc(template: ArcTemplate | undefined): boolean {
  return Boolean(template && (template.question.trim() || template.fronts.length));
}

/* ------------------------------------------------------------------ *
 * The instance's life
 * ------------------------------------------------------------------ */

/** Open a template for play — the New Adventure and handoff path both land here. */
export function openArc(
  template: ArcTemplate,
  id: string,
  turn: number,
  day: number,
): Arc {
  const clean = normalizeTemplate(template);
  return normalizeArc({
    id,
    question: clean.question,
    spine: clean.spine,
    fronts: openFronts(clean.fronts, day),
    epoch: 0,
    status: "running",
    areas: [],
    openedTurn: turn,
  });
}

/**
 * Bump the arc's epoch — the staleness signal every area prepped under it
 * reads. Fired when a front fires or retires, or when a handoff rewrites the
 * question: all three mean the areas around the player now describe a world
 * that has moved.
 */
export function bumpEpoch(arc: Arc): Arc {
  return { ...arc, epoch: arc.epoch + 1 };
}

/** Has the spine fired? The one test for "this story is over". */
export function spineFired(arc: Arc): boolean {
  return arc.fronts.some((f) => f.id === arc.spine && f.status === "fired");
}

/**
 * Move the arc into its interlude — a STATE, not a scene. While it holds,
 * nothing ticks (the caller skips the whole reckon), the prep block is replaced
 * by breathing room, and the handoff to the next arc is staged for the player.
 */
export function toInterlude(arc: Arc, turn: number): Arc {
  if (arc.status !== "running") return arc;
  return { ...arc, status: "interlude", interludeFrom: turn };
}

/** How many turns the interlude has been running. */
export function interludeTurnsSoFar(arc: Arc, turn: number): number {
  if (arc.status !== "interlude" || arc.interludeFrom === undefined) return 0;
  return Math.max(0, turn - arc.interludeFrom);
}

/**
 * Has the interlude run its course? Also the trigger that APPLIES a staged
 * handoff the player never looked at: co-authoring is an offer, and an
 * interlude must never dead-end into arcless play because the Arc screen went
 * unvisited.
 */
export function interludeOver(arc: Arc, turn: number, interludeTurns: number): boolean {
  if (arc.status !== "interlude") return false;
  return interludeTurnsSoFar(arc, turn) >= Math.max(1, interludeTurns);
}

/**
 * Close this arc and open the next from a template — the handoff, applied.
 *
 * The closed arc is kept: `GameState.arcs` is a list, so the Arc screen doubles
 * as campaign history and the journal's `arcId` stamp keeps meaning something
 * after the chapter ends.
 */
export function handOff(
  arcs: Arc[],
  template: ArcTemplate,
  id: string,
  turn: number,
  day: number,
): Arc[] {
  const current = runningArc(arcs);
  const next = openArc(template, id, turn, day);
  if (!current) return [...arcs, next];
  return [
    ...arcs.map((a) =>
      a.id === current.id ? { ...a, status: "done" as const, staged: undefined } : a,
    ),
    next,
  ];
}

/**
 * End an interlude with no staged arc to open — the player chose *move on* and
 * the handoff call never landed. The arc resumes rather than the campaign
 * stalling, and every open front's clock reference moves to today so the
 * suspended days don't arrive at once as a neglect burst.
 */
export function resumeArc(arc: Arc, day: number): Arc {
  if (arc.status !== "interlude") return arc;
  return {
    ...arc,
    status: "running",
    interludeFrom: undefined,
    fronts: restFronts(arc.fronts, day),
  };
}

/* ------------------------------------------------------------------ *
 * The handoff call
 *
 * The arc's PROMPT blocks deliberately live in `prompt.ts` beside every other
 * block formatter, not here: this module builds a side call, so it imports
 * `prompt.ts`, and prompt assembly importing back would be a cycle.
 * ------------------------------------------------------------------ */

/**
 * The messages for the handoff — the highest-stakes call in the system, since
 * it writes the next several hours of play off a summary. That is exactly why
 * its result is STAGED rather than applied (see `Arc.staged`).
 *
 * Reads the journal, the arc that just closed, the cast and the world — never
 * the raw beats, which is the same discipline as every other authoring call
 * here: the beats are what the journal already compressed.
 */
export function buildArcMessages(
  settings: Settings,
  game: GameState,
  characters: Character[],
  closing: Arc | undefined,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  messages.push({
    role: "system",
    content: [
      "NEXT ARC — you are writing the shape of the next chapter of an ongoing text adventure, not narrating it.",
      'Reply with a single JSON object and nothing else — no prose, no commentary, no code fences:',
      '{ "question": "…", "fronts": [ { "id": "…", "label": "…", "steps": ["…", "…"] } ], "spine": "<one front id>" }',
      "",
      "THE SHAPE",
      `- "question" is what this chapter is ABOUT, in one line. Not a task the player is given — a question the play answers.`,
      `- "fronts" are the things closing in, at most ${MAX_FRONTS} of them. Each has a short "label" ("the mine floods") and "steps": what happens as it advances, worst last, 2 to ${MAX_CLOCK} of them. Write the steps in ADVANCE and in order.`,
      `- "spine" is the id of the ONE front whose arrival ends this chapter. The others are texture.`,
      "- Nothing here is a number the player sees, and none of it is narrated at you. Do not write ticks, counters, days or scene directions.",
      settings.arcInstructions.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const scenario = formatScenarioBlock(game.scenario);
  if (scenario) messages.push({ role: "system", content: scenario });

  if (closing) {
    messages.push({
      role: "system",
      content: [
        "THE CHAPTER THAT JUST CLOSED — do not repeat it. The next one grows out of what it left behind.",
        closing.question.trim() ? `Question: ${closing.question.trim()}` : "",
        ...closing.fronts.map(
          (f) => `- ${f.label} — ${f.status}${f.status === "fired" ? ` (${nextStep(f)})` : ` ${clockFace(f)}`}`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  const cast = characters
    .filter((c) => c.role === "pc" || game.roster.some((e) => e.id === c.id && e.standing !== "none"))
    .map((c) => `- ${formatIdentity(c)}${c.drive ? ` — wants: ${c.drive}` : ""}`);
  if (cast.length) {
    messages.push({
      role: "system",
      content: `THE PEOPLE — who this chapter happens to.\n${cast.join("\n")}`,
    });
  }

  const journal = formatJournalBlock(game.journal, settings.journalBudget);
  if (journal) messages.push({ role: "system", content: journal });

  messages.push({
    role: "user",
    content: "Write the next arc. Emit the JSON object now.",
  });

  return messages;
}

/**
 * Pull an arc template out of a model reply. Tolerant about the wrapper (the
 * same `extractFirstJsonObject` the turn block uses), strict about the contents
 * — `normalizeTemplate` drops what it can't use, and a reply with no usable
 * front at all returns null so the caller can leave the arc alone rather than
 * staging an empty chapter.
 */
export function parseArc(raw: string): ArcTemplate | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Partial<ArcTemplate>>(json);
  if (!parsed) return null;
  const template = normalizeTemplate(parsed);
  return hasArc(template) ? template : null;
}
