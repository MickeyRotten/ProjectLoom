import type { Arc, Front, FrontTemplate } from "../types";

/**
 * Fronts and their clocks — the half of Foresight the CLIENT owns outright.
 *
 * A front is one thing closing in on the player, written in advance as a list
 * of steps. The length of that list IS the clock; a tick advances it; reaching
 * the end fires it. The model authors the steps at a boundary and never touches
 * the count, for exactly the reason it no longer writes the day: two writers for
 * one number is how the day came to freeze, jump and run backwards.
 *
 * Ticks come from two places, and the second is the interesting one:
 *  - a COST outcome rolled in a room whose area serves this front (and a MIXED
 *    one, if the table wants that);
 *  - **neglect** — a front nobody has touched for `frontNeglectDays` in-game
 *    days ticks on its own. That is what makes the world move while the player
 *    does something else, and it hangs off `clock.ts`, which the client also
 *    owns.
 *
 * Pure + tested.
 */

/** A clock shorter than this is not a clock; longer than this is a campaign. */
export const MIN_CLOCK = 2;
export const MAX_CLOCK = 8;

/** How many steps of a front the prompt ever shows: the next one. The rest is spoiler. */
export const STEPS_SHOWN = 1;

/**
 * One front onto the shape the app can actually spend, sanitized at READ.
 *
 * Steps past the clock are DROPPED rather than clamped and `ticks` is pinned
 * inside `0..steps.length`, so a hand-edited or model-authored front is
 * unrepresentable rather than merely out of range — the `normalizeDice` stance.
 */
export function normalizeFront(raw: Partial<Front> & { id?: string }, index = 0): Front {
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_CLOCK);
  // A front with nothing written on its clock still needs one, or it can never
  // fire and quietly stops being a front at all.
  while (steps.length < MIN_CLOCK) steps.push("…");

  const ticks = Number.isFinite(raw.ticks) ? Math.round(raw.ticks as number) : 0;
  const status: Front["status"] =
    raw.status === "fired" || raw.status === "retired" ? raw.status : "open";

  return {
    id: (raw.id ?? "").trim() || `front-${index + 1}`,
    label: (raw.label ?? "").trim() || "something is coming",
    steps,
    ticks: Math.min(steps.length, Math.max(0, ticks)),
    lastTickDay: Number.isFinite(raw.lastTickDay) ? Math.round(raw.lastTickDay as number) : 0,
    status,
  };
}

/** A template's fronts, opened for play on `day`. */
export function openFronts(templates: FrontTemplate[], day: number): Front[] {
  return templates.map((t, i) =>
    normalizeFront({ ...t, ticks: 0, lastTickDay: day, status: "open" }, i),
  );
}

/** The fronts still capable of firing. */
export function liveFronts(arc: Arc | undefined): Front[] {
  return (arc?.fronts ?? []).filter((f) => f.status === "open");
}

/** How the clock reads: `●●○○`. Rendered for the player and for the narrator alike. */
export function clockFace(front: Front): string {
  return "●".repeat(front.ticks) + "○".repeat(Math.max(0, front.steps.length - front.ticks));
}

/** The step this front is about to reach — the only one anybody is ever shown. */
export function nextStep(front: Front): string {
  return front.steps[Math.min(front.ticks, front.steps.length - 1)] ?? "";
}

export interface TickResult {
  fronts: Front[];
  /** Labels of the fronts that moved. */
  ticked: string[];
  /** Labels of the fronts that reached the end of their clock this time. */
  fired: string[];
}

/** Nothing moved — the shape every no-op tick returns, references intact. */
function unchanged(fronts: Front[]): TickResult {
  return { fronts, ticked: [], fired: [] };
}

/**
 * Advance one front by one step. A front that reaches the end of its clock goes
 * `fired`, which is what the next turn's mandatory block and the arc's
 * completion check both read.
 *
 * Reference-stable: an id naming nothing, or a front that is not open, comes
 * back untouched.
 */
export function tickFront(fronts: Front[], id: string, day: number): TickResult {
  const i = fronts.findIndex((f) => f.id === id && f.status === "open");
  if (i < 0) return unchanged(fronts);

  const front = fronts[i];
  const ticks = Math.min(front.steps.length, front.ticks + 1);
  const fired = ticks >= front.steps.length;
  const next: Front = {
    ...front,
    ticks,
    lastTickDay: day,
    status: fired ? "fired" : front.status,
  };
  const out = [...fronts];
  out[i] = next;
  return { fronts: out, ticked: [front.label], fired: fired ? [front.label] : [] };
}

/**
 * The neglect pass: every open front untouched for `neglectDays` in-game days
 * ticks once. One tick per pass, however many days have piled up — a front is a
 * clock, not an interest rate, and a player returning from a week away should
 * find the world moved on, not ended.
 *
 * Never runs while an arc is in interlude; the caller advances `lastTickDay` on
 * resume so the suspended days don't arrive at once as a burst.
 */
export function tickNeglect(fronts: Front[], day: number, neglectDays: number): TickResult {
  if (neglectDays <= 0) return unchanged(fronts);

  let out = fronts;
  const ticked: string[] = [];
  const fired: string[] = [];
  for (const front of fronts) {
    if (front.status !== "open") continue;
    if (day - front.lastTickDay < neglectDays) continue;
    const result = tickFront(out, front.id, day);
    out = result.fronts;
    ticked.push(...result.ticked);
    fired.push(...result.fired);
  }
  return out === fronts ? unchanged(fronts) : { fronts: out, ticked, fired };
}

/**
 * Move every open front's clock reference forward without ticking it — what an
 * interlude's END does. Without it, the days an interlude suspended would all
 * arrive on the first turn back as a neglect burst, which is the exact opposite
 * of the pressure release the interlude exists to be.
 */
export function restFronts(fronts: Front[], day: number): Front[] {
  let changed = false;
  const out = fronts.map((f) => {
    if (f.status !== "open" || f.lastTickDay >= day) return f;
    changed = true;
    return { ...f, lastTickDay: day };
  });
  return changed ? out : fronts;
}

/**
 * The `FRONT` half of the prep block: what is closing in, how far along it is,
 * and the ONE step it is about to reach. The steps after that are spoiler for
 * the narrator and noise in the budget.
 */
export function formatFrontLines(fronts: Front[]): string[] {
  return fronts.map((f) => `  ${f.label}  ${clockFace(f)}  next: ${nextStep(f)}`);
}

/**
 * The mandatory block a fired front gets: this turn, the thing that has been
 * coming arrives. Authoritative in the same voice as the outcome band, and for
 * the same reason — a block that reads as advice gets narrated as a near miss.
 */
export function formatLoomingBlock(front: Front): string {
  const last = front.steps[front.steps.length - 1] ?? front.label;
  return [
    `THE FRONT ARRIVES — ${front.label.toUpperCase()} (authoritative: this happens in the beat you are about to write, not later)`,
    last,
    "The clock on this has run out. Write it into the scene as it stands — the player does not get a warning they have already had.",
  ].join("\n");
}
