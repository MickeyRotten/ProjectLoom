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
import { clockFace, nextStep, normalizeFront, openFront, restFront } from "./fronts";
import { clampArcSteps } from "./settings";
import { formatIdentity } from "./roster";
import { formatWorldNotesBlock, matchWorldNotes } from "./worldNotes";

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
 * **One question, one front.** The arc used to carry up to four fronts and name
 * one of them its spine; the rest were texture nobody could see moving. Now the
 * arc is a question and the one thing closing in while it is answered, so
 * `spine` is not a field anybody has to choose — that front's arrival IS the end
 * of the chapter.
 *
 * **Completion is client-owned and deterministic.** The model never declares a
 * story over, for the same reason it never ticks a clock.
 *
 * Pure + tested; only the store touches the network.
 */

/**
 * Cooler than the authoring calls (`generateField.ts` runs at 0.9) and warmer
 * than the journal's 0.3. A handoff invents a story, so it cannot be cold; it
 * also has to stay inside a campaign somebody else has been writing for hours.
 */
export const ARC_TEMPERATURE = 0.7;

/* ------------------------------------------------------------------ *
 * Reading and sanitizing
 * ------------------------------------------------------------------ */

/**
 * The front out of any shape an arc has ever been written in — this one's
 * `front`, or the `fronts[]`/`spine` pair every arc stored before the collapse
 * carries. The spine is the one that ended the chapter, so it is the one that
 * survives; with no spine naming anything, the first.
 *
 * Also the tolerant half of `parseArc`: a model handed the new contract still
 * reaches for the old plural often enough to be worth reading.
 */
function pickFront(raw: unknown): Partial<Front> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;

  if (rec.front && typeof rec.front === "object") return rec.front as Partial<Front>;
  // A bare label with no clock: kept, since a named front with placeholder steps
  // is editable and a dropped one is not.
  if (typeof rec.front === "string" && rec.front.trim()) return { label: rec.front };

  if (Array.isArray(rec.fronts)) {
    const fronts = rec.fronts.filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object");
    const spine = typeof rec.spine === "string" ? rec.spine : "";
    const chosen = fronts.find((f) => f.id === spine) ?? fronts[0];
    return chosen as Partial<Front> | undefined;
  }
  return undefined;
}

/** One arc onto the shape the app can spend, sanitized at READ. */
export function normalizeArc(raw: Partial<Arc> | undefined, index = 0): Arc {
  const front = pickFront(raw);

  const status: Arc["status"] =
    raw?.status === "interlude" || raw?.status === "done" ? raw.status : "running";

  return {
    id: (raw?.id ?? "").trim() || `arc-${index + 1}`,
    question: (raw?.question ?? "").trim(),
    ...(front ? { front: normalizeFront(front) } : {}),
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
  const picked = pickFront(raw);
  const front: FrontTemplate | undefined = picked
    ? (({ label, steps }) => ({ label, steps }))(normalizeFront(picked))
    : undefined;
  return {
    question: (raw?.question ?? "").trim(),
    ...(front ? { front } : {}),
  };
}

/** The arc the story is currently inside — running or in interlude. */
export function runningArc(arcs: Arc[] | undefined): Arc | undefined {
  return (arcs ?? []).find((a) => a.status !== "done");
}

/** Does this template say anything at all? A blank one is not worth opening. */
export function hasArc(template: ArcTemplate | undefined): boolean {
  return Boolean(template && (template.question.trim() || template.front));
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
    front: openFront(clean.front, day),
    epoch: 0,
    status: "running",
    areas: [],
    openedTurn: turn,
  });
}

/**
 * Bump the arc's epoch — the staleness signal every area prepped under it
 * reads. Fired when the front fires or retires, or when a handoff rewrites the
 * question: all three mean the areas around the player now describe a world
 * that has moved.
 */
export function bumpEpoch(arc: Arc): Arc {
  return { ...arc, epoch: arc.epoch + 1 };
}

/** Has the front fired? The one test for "this story is over". */
export function frontFired(arc: Arc): boolean {
  return arc.front?.status === "fired";
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
 * Replace the arc the story is INSIDE, keeping its seat — the Arc screen's
 * rewrite, applied.
 *
 * The sibling of `handOff`, and the difference is the whole point: a handoff
 * closes a chapter and opens the next one beside it, so both are campaign
 * history. A rewrite is the player saying *this chapter is not the one I
 * wanted*, so there is no history to keep — the id, the seat in `GameState.arcs`
 * and the areas it has touched all survive, and the question, the front and the
 * clock are written again from scratch.
 *
 * The epoch bumps for the same reason it bumps when a front fires: every area
 * card prepped under the old question now describes a world that no longer
 * exists, and `(arcId, epoch)` is the pair that says so. `status` is pinned back
 * to `running` and the interlude marker cleared, so a rewrite is total no matter
 * what state it is called in.
 */
export function rewriteArc(arc: Arc, template: ArcTemplate, day: number): Arc {
  const clean = normalizeTemplate(template);
  return normalizeArc({
    ...arc,
    question: clean.question,
    front: openFront(clean.front, day),
    epoch: arc.epoch + 1,
    status: "running",
    interludeFrom: undefined,
    staged: undefined,
  });
}

/**
 * End an interlude with no staged arc to open — the player chose *move on* and
 * the handoff call never landed. The arc resumes rather than the campaign
 * stalling, and the front's clock reference moves to today so the suspended
 * days don't arrive at once as a neglect burst.
 */
export function resumeArc(arc: Arc, day: number): Arc {
  if (arc.status !== "interlude") return arc;
  return {
    ...arc,
    status: "running",
    interludeFrom: undefined,
    front: restFront(arc.front, day),
  };
}

/* ------------------------------------------------------------------ *
 * The arc call
 *
 * The arc's PROMPT blocks deliberately live in `prompt.ts` beside every other
 * block formatter, not here: this module builds a side call, so it imports
 * `prompt.ts`, and prompt assembly importing back would be a cycle.
 * ------------------------------------------------------------------ */

/**
 * Why the arc call is being made. `next` is the handoff — a chapter closed, and
 * this writes the one that grows out of it. `rewrite` is the player pressing ✦
 * on a chapter they are still inside and asking for a different one, which is a
 * different instruction in two places: the arc shown is being REPLACED rather
 * than built on, so restating it is the failure mode rather than the point.
 */
export type ArcCallMode = "next" | "rewrite";

/**
 * The text the World Notes matcher scans for an arc call: what the scenario
 * says, what the arc in hand is about, and — the reason this exists — whatever
 * the player typed into Guidance.
 *
 * Same rule as every other ✦ flow (`generateField.ts → fieldScanText`,
 * `generateItem.ts → itemScanText`): a player who asks for a chapter about the
 * Sunken Choir should get the Sunken Choir's note in front of the model, and
 * before this the arc call read no notes at all.
 */
export function arcScanText(
  game: GameState,
  arc: Arc | undefined,
  guidance?: string,
): string {
  const s = game.scenario;
  return [
    guidance ?? "",
    s.title,
    s.startRegion,
    s.startRoom,
    s.premise,
    arc?.question ?? "",
    arc?.front?.label ?? "",
  ]
    .filter((t) => t && t.trim())
    .join("\n");
}

/**
 * The messages for the arc call — the highest-stakes call in the system, since
 * it writes the next several hours of play off a summary. That is exactly why
 * its result is STAGED rather than applied (see `Arc.staged`).
 *
 * Reads the journal, the arc in hand, the cast and the world — never the raw
 * beats, which is the same discipline as every other authoring call here: the
 * beats are what the journal already compressed.
 *
 * Two of its inputs are the player's, taken straight off the Arc screen:
 * `Settings.arcSteps` is the clock length it must write to (a number the client
 * owns, so the model is told the count rather than asked for one), and
 * `Settings.arcGuidance` is free-text direction, injected as its own block —
 * blank adds nothing, exactly the way a blank instruction field removes a rule.
 * The guidance also feeds the World Notes matcher, so asking for a chapter about
 * something the player has written lore for pulls that lore in.
 *
 * `mode` decides what the arc in `previous` MEANS: the chapter this one grows
 * out of, or the chapter this one replaces.
 */
export function buildArcMessages(
  settings: Settings,
  game: GameState,
  characters: Character[],
  previous: Arc | undefined,
  mode: ArcCallMode = "next",
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const steps = clampArcSteps(settings.arcSteps);
  const rewrite = mode === "rewrite";

  messages.push({
    role: "system",
    content: [
      rewrite
        ? "ARC — you are writing the shape of a chapter of an ongoing text adventure, not narrating it. The chapter it replaces is below, and the player has asked for a different one."
        : "NEXT ARC — you are writing the shape of the next chapter of an ongoing text adventure, not narrating it.",
      'Reply with a single JSON object and nothing else — no prose, no commentary, no code fences:',
      '{ "question": "…", "front": { "label": "…", "steps": ["…", "…"] } }',
      "",
      "THE SHAPE",
      `- "question" is what this chapter is ABOUT, in one line. Not a task the player is given — a question the play answers.`,
      `- "front" is the ONE thing closing in while that question is answered. "label" names it short ("the mine floods"). Its arrival ends the chapter, so make it worth arriving.`,
      `- "steps" is what happens as it advances, in order, worst last. Write EXACTLY ${steps} of them, in advance.`,
      "- The front is not tied to any one place: it closes in wherever the player is.",
      "- Nothing here is a number the player sees, and none of it is narrated at you. Do not write ticks, counters, days or scene directions.",
      settings.arcInstructions.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const guidance = settings.arcGuidance.trim();
  if (guidance) {
    messages.push({
      role: "system",
      content: `WHAT THE PLAYER WANTS FROM THIS CHAPTER — authoritative. Write the arc they asked for.\n${guidance}`,
    });
  }

  const scenario = formatScenarioBlock(game.scenario);
  if (scenario) messages.push({ role: "system", content: scenario });

  if (previous) {
    messages.push({
      role: "system",
      content: [
        rewrite
          ? "THE CHAPTER BEING REPLACED — the player did not want this one. Write a DIFFERENT chapter of the same story: do not restate its question, and do not name the same thing closing in."
          : "THE CHAPTER THAT JUST CLOSED — do not repeat it. The next one grows out of what it left behind.",
        previous.question.trim() ? `Question: ${previous.question.trim()}` : "",
        previous.front
          ? `- ${previous.front.label} — ${previous.front.status}${
              previous.front.status === "fired"
                ? ` (${nextStep(previous.front)})`
                : ` ${clockFace(previous.front)}`
            }`
          : "",
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

  // Lore the guidance, the scenario and the arc in hand reach for. Last of the
  // context blocks, and never gated on the beats: this is authoring.
  const notes = formatWorldNotesBlock(
    matchWorldNotes(game.worldNotes, arcScanText(game, previous, guidance)),
  );
  if (notes) messages.push({ role: "system", content: notes });

  const journal = formatJournalBlock(game.journal, settings.journalBudget);
  if (journal) messages.push({ role: "system", content: journal });

  messages.push({
    role: "user",
    content: rewrite
      ? "Write the arc again. Emit the JSON object now."
      : "Write the next arc. Emit the JSON object now.",
  });

  return messages;
}

/**
 * Pull an arc template out of a model reply. Tolerant about the wrapper (the
 * same `extractFirstJsonObject` the turn block uses), strict about the contents
 * — `normalizeTemplate` drops what it can't use, and a reply with nothing usable
 * in it returns null so the caller can leave the arc alone rather than staging
 * an empty chapter.
 */
export function parseArc(raw: string): ArcTemplate | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;
  const parsed = parseJsonTolerant<Partial<ArcTemplate>>(json);
  if (!parsed) return null;
  const template = normalizeTemplate(parsed);
  return hasArc(template) ? template : null;
}
