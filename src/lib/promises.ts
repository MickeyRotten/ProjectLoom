import type { PromiseDelta, StoryPromise } from "../types";
import { slug } from "./names";

/**
 * Promises — the cheapest of Foresight's three channels, and the one that runs
 * every turn rather than at a boundary.
 *
 * A promise is a commitment the prose just made: *the tremor in the walls*,
 * *the man watching from the gallery*. The narrator plants it in one line; the
 * client stamps the turn, ages it, escalates the wording when it has been
 * outstanding too long, and drops it when it plainly never mattered. Area and
 * room prep both read the outstanding ones, which is the wire that turns a
 * promise into a threat, a threat into a rolled band, and a band into a front
 * tick — one chain.
 *
 * The client owning the AGE is the whole discipline of this feature again: a
 * model asked how old its own promise is will answer with a number that suits
 * the beat it wants to write.
 *
 * Pure + tested.
 */

/** How many outstanding promises the prompt ever shows. Newest first. */
export const PROMISES_SHOWN = 3;

/** Hard cap on how many are kept at all — a plant a turn is a flood. */
export const MAX_PROMISES = 12;

/** Hard cap on one promise, in characters. It is a phrase, not a beat. */
export const MAX_PROMISE_CHARS = 120;

/** A promise matches another by slug, so two spellings of one thing are one thing. */
const key = (text: string) => slug(text);

/** Sanitize a stored list — blank text, duplicates and junk rows out. */
export function normalizePromises(raw: unknown): StoryPromise[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: StoryPromise[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const p = row as Partial<StoryPromise>;
    const text = typeof p.text === "string" ? p.text.trim().slice(0, MAX_PROMISE_CHARS) : "";
    const k = key(text);
    if (!text || !k || seen.has(k)) continue;
    seen.add(k);
    out.push({
      id: typeof p.id === "string" && p.id ? p.id : `promise-${k}`,
      text,
      plantedTurn: Number.isFinite(p.plantedTurn) ? Math.round(p.plantedTurn as number) : 0,
    });
  }
  return out.slice(-MAX_PROMISES);
}

/**
 * Apply this turn's promise ops. Reference-stable — a turn with no ops, or with
 * only ops that change nothing, comes back with the same array.
 *
 * `add` for text already promised is not a re-plant: the promise keeps its
 * ORIGINAL turn, or a narrator restating it every beat would keep it forever
 * young and it could never age into an escalation.
 */
export function applyPromises(
  promises: StoryPromise[],
  deltas: PromiseDelta[] | undefined,
  turn: number,
): StoryPromise[] {
  if (!deltas?.length) return promises;

  let out = promises;
  let changed = false;
  for (const d of deltas) {
    const text = typeof d?.text === "string" ? d.text.trim().slice(0, MAX_PROMISE_CHARS) : "";
    const k = key(text);
    if (!k) continue;

    if (d.op === "remove") {
      const next = out.filter((p) => key(p.text) !== k);
      if (next.length !== out.length) {
        out = next;
        changed = true;
      }
      continue;
    }

    if (out.some((p) => key(p.text) === k)) continue;
    out = [...out, { id: `promise-${turn}-${k}`, text, plantedTurn: turn }].slice(-MAX_PROMISES);
    changed = true;
  }
  return changed ? out : promises;
}

/**
 * Drop the promises nobody is going to pay off. A promise is escalated at
 * `promiseTurns` (see `formatPromisesBlock`) and dropped at twice that — the
 * narrator was told to pay it off or let it go, and letting it go has to
 * actually mean something or the block grows forever.
 */
export function agePromises(
  promises: StoryPromise[],
  turn: number,
  promiseTurns: number,
): StoryPromise[] {
  if (promiseTurns <= 0) return promises;
  const limit = promiseTurns * 2;
  const kept = promises.filter((p) => turn - p.plantedTurn <= limit);
  return kept.length === promises.length ? promises : kept;
}

/** The ops this turn's block actually changes something with (`reconcileBlock`). */
export function reconcilePromises(
  current: StoryPromise[],
  deltas: PromiseDelta[] | undefined,
): PromiseDelta[] | undefined {
  if (!deltas?.length) return deltas;
  const held = new Set(current.map((p) => key(p.text)));
  let changed = false;
  const kept: PromiseDelta[] = [];
  for (const d of deltas) {
    const k = key(typeof d?.text === "string" ? d.text : "");
    // An `add` for something already promised and a `remove` for something
    // never promised both change nothing — and a chip claiming otherwise is a
    // claim that the beat did something it didn't.
    const noop = !k || (d.op === "remove" ? !held.has(k) : held.has(k));
    if (noop) {
      changed = true;
      continue;
    }
    if (d.op === "remove") held.delete(k);
    else held.add(k);
    kept.push(d);
  }
  return changed ? kept : deltas;
}

/**
 * The `PROMISES` line of the prep block: what the prose has committed to and
 * not yet paid off, newest first, with the age spelled out.
 *
 * Past `promiseTurns` the wording escalates to *pay it off or let it go* — one
 * sentence, and the only pressure the client applies to a promise. Blank when
 * there is nothing outstanding, so a quiet campaign adds no tokens.
 */
export function formatPromisesBlock(
  promises: StoryPromise[],
  turn: number,
  promiseTurns: number,
): string {
  if (!promises.length) return "";
  const lines = [...promises]
    .slice(-PROMISES_SHOWN)
    .reverse()
    .map((p) => {
      const age = Math.max(0, turn - p.plantedTurn);
      const when = age <= 0 ? "just now" : `${age} turn${age === 1 ? "" : "s"} ago`;
      const overdue = promiseTurns > 0 && age >= promiseTurns;
      return `  ${p.text} (${when})${overdue ? " — pay it off or let it go" : ""}`;
    });
  return ["PROMISES — what your own prose has already committed to", ...lines].join("\n");
}

/**
 * The `YOU PLANNED THIS` line: the note written for the option the player just
 * tapped, handed back on the turn it is taken. Blank for a typed action, which
 * is correct — the note was written for the button, not for the wording.
 */
export function formatOptionNote(note: string | undefined): string {
  const text = (note ?? "").trim();
  if (!text) return "";
  return `YOU PLANNED THIS — when you offered this action last turn, this is what you said it risked: "${text}". Honour it.`;
}
