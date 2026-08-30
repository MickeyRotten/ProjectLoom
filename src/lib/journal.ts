import type {
  Character,
  GameState,
  JournalEntry,
  JournalLine,
  Message,
  Settings,
} from "../types";
import { type ChatMessage, formatScenarioBlock } from "./prompt";
import { extractFirstJsonObject, parseJsonTolerant } from "./loomBlock";
import { findByName } from "./names";

/**
 * The journal — what happened, as a short list.
 *
 * The rolling history window is a fixed token budget (`prompt.ts →
 * buildHistory`), so a turn that falls out of it has never happened as far as
 * the model is concerned. That is the campaign's memory ceiling. The journal is
 * what catches the material on its way out: it reads `GameState.messages`, the
 * FULL transcript, not the trimmed window, so it can still see the beats the
 * model stopped being shown thirty turns ago.
 *
 * Two authors, one shape. Every line is one short sentence:
 *  - `system` lines are derived here from `Message.appliedDeltas` — the same
 *    records `toasts.ts` reads for its chips. Exact, free, unfakeable.
 *  - `model` lines come from the side call and cover the half no delta can see:
 *    crossed the marsh, refused the ferryman, the bridge was out.
 * Grounding the writer on facts it cannot invent is the cheapest accuracy the
 * feature gets, and it means a failed call still leaves a usable entry.
 *
 * The boundary is the CLIENT's, never the model's. It hangs off the clock
 * (`clock.ts`), which the client also owns — a long rest that lands in a new
 * day, or a turn ceiling for a player who never sleeps.
 *
 * Pure + tested: assembly and parsing live here, only the store touches the
 * network.
 */

/** Hard cap on the lines one entry's side call may contribute. */
export const JOURNAL_MAX_LINES = 6;

/** Hard cap on one line, in characters. A line is a log entry, not a beat. */
export const JOURNAL_MAX_LINE_CHARS = 120;

/**
 * Cooler than the authoring calls (`generateField.ts` runs at 0.9). This is
 * record-keeping: the same day summarised twice should come out much the same,
 * and invention is the one thing it must not do.
 */
export const JOURNAL_TEMPERATURE = 0.3;

/* ------------------------------------------------------------------ *
 * The boundary
 * ------------------------------------------------------------------ */

export interface OpenEntryOptions {
  /** The game as it stands AFTER this turn, with the new beat in `messages`. */
  game: GameState;
  settings: Settings;
  characters: Character[];
  /** The turn that just resolved. */
  turn: number;
  /** The day after this turn's duration. */
  day: number;
  /** This turn was a night's sleep (`clock.ts → advanceClock`). */
  rested: boolean;
}

/** The turn the next entry starts from: one past whatever the last one covered. */
export function nextFromTurn(journal: JournalEntry[]): number {
  const last = journal[journal.length - 1];
  return last ? last.throughTurn + 1 : 1;
}

/**
 * Whether the interval ending at `turn` has earned an entry.
 *
 * The long rest is the boundary, not the calendar. Rolling on midnight would
 * cut a tavern scene in half; waiting for someone to actually sleep matches how
 * the day is played, and the ceiling covers the player who never does.
 */
export function shouldJournal(opts: OpenEntryOptions): boolean {
  const { settings, game, turn, day, rested } = opts;
  if (!settings.features.journal) return false;

  const from = nextFromTurn(game.journal);
  const span = turn - from + 1;
  if (span <= 0) return false;
  if (span >= Math.max(1, settings.journalMaxTurns)) return true;
  // Below the floor an interval folds into the next one rather than becoming a
  // two-turn entry — a day crossed on the second turn is not a day.
  if (span < Math.max(1, settings.journalMinTurns)) return false;

  const last = game.journal[game.journal.length - 1];
  const previousDay = last ? last.day : undefined;
  return rested && (previousDay === undefined || day > previousDay);
}

/**
 * Open the entry this turn closed, or return the journal untouched.
 *
 * The entry is created with its `system` lines only — no network — so it exists
 * before the caller snapshots for reversal. Its written lines are appended
 * later by `appendModelLines`.
 */
export function openJournalEntry(opts: OpenEntryOptions): JournalEntry[] {
  if (!shouldJournal(opts)) return opts.game.journal;

  const from = nextFromTurn(opts.game.journal);
  const entry: JournalEntry = {
    id: `j-${opts.turn}-${from}`,
    // The day the interval STARTED — an entry that spans a midnight belongs to
    // the day that was being lived, not the one it ended in.
    day: startDay(opts.game.messages, from, opts.day),
    fromTurn: from,
    throughTurn: opts.turn,
    lines: milestoneLines(opts.game.messages, from, opts.turn, opts.characters),
  };
  return [...opts.game.journal, entry];
}

/** The day the first beat of the interval was recorded on. */
function startDay(messages: Message[], fromTurn: number, fallback: number): number {
  const first = messages.find((m) => m.turn >= fromTurn && m.day !== undefined);
  return first?.day ?? fallback;
}

/**
 * Append the written lines to an entry, by id. Returns the same array when the
 * id is gone — the player may have hit undo while the call was in flight, and a
 * late write must never resurrect an entry reversal removed.
 */
export function appendModelLines(
  journal: JournalEntry[],
  id: string,
  lines: string[],
): JournalEntry[] {
  const i = journal.findIndex((e) => e.id === id);
  if (i < 0 || !lines.length) return journal;
  const written: JournalLine[] = lines.map((text) => ({ text, source: "model" }));
  const next = [...journal];
  next[i] = { ...next[i], lines: [...next[i].lines, ...written] };
  return next;
}

/* ------------------------------------------------------------------ *
 * The lines the client writes for itself
 * ------------------------------------------------------------------ */

/**
 * The factual half of an entry, read off the recorded blocks of the turns in
 * range. Deliberately narrow: quests, the cast, marks, and moves. Inventory is
 * left out — an acquisition a turn is a flood, and what the player carries is
 * re-read from state every turn anyway.
 */
export function milestoneLines(
  messages: Message[],
  fromTurn: number,
  throughTurn: number,
  characters: Character[],
): JournalLine[] {
  const out: string[] = [];
  const push = (text: string) => {
    if (!out.includes(text)) out.push(text);
  };
  // Recorded blocks name whoever the narrator was calling them at the time, so
  // this resolves through former names too — a journal written after a rename
  // should say who the character is now, not who they were called then.
  const named = (name: string) => findByName(characters, name)?.name ?? name.trim();

  let location: string | undefined;
  for (const msg of messages) {
    if (msg.turn < fromTurn || msg.turn > throughTurn) continue;

    // A move is a change of place across the interval, not every time the
    // narrator restates where everyone is standing.
    if (msg.location && msg.location !== location) {
      if (location !== undefined) push(`Travelled to ${msg.location}.`);
      location = msg.location;
    }

    const block = msg.appliedDeltas;
    if (!block) continue;

    for (const d of block.party ?? []) {
      if (!d?.name) continue;
      if (d.op === "remove" || d.standing === "departed") push(`${named(d.name)} left.`);
      else if (d.standing === "fallen") push(`${named(d.name)} fell.`);
      else if (d.op === "add" && d.standing !== "npc") push(`${named(d.name)} joined.`);
      else if (d.op === "add") push(`Met ${named(d.name)}.`);
    }

    for (const d of block.conditions ?? []) {
      if (!d?.name || typeof d.condition !== "string") continue;
      const mark = d.condition.trim();
      push(mark ? `${named(d.name)}: ${mark}.` : `${named(d.name)} recovered.`);
    }

    for (const d of block.quests ?? []) {
      if (!d?.label) continue;
      if (d.op === "add") push(`Took on: ${d.label}.`);
      else if (d.op === "update" && d.status === "done") push(`Completed: ${d.label}.`);
    }
  }

  return out.map((text) => ({ text, source: "system" as const }));
}

/* ------------------------------------------------------------------ *
 * The side call
 * ------------------------------------------------------------------ */

/**
 * The messages for the entry's writing call. Reads the interval's beats and the
 * facts already extracted from it, and is told not to repeat them — so the call
 * spends its budget on the half the deltas could not see.
 */
export function buildJournalMessages(
  settings: Settings,
  game: GameState,
  entry: JournalEntry,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  const scenario = formatScenarioBlock(game.scenario);
  if (scenario) messages.push({ role: "system", content: scenario });

  const facts = entry.lines.filter((l) => l.source === "system");
  if (facts.length) {
    messages.push({
      role: "system",
      content: `FACTS ALREADY RECORDED for this stretch — do not repeat any of them:\n${facts
        .map((l) => `- ${l.text}`)
        .join("\n")}`,
    });
  }

  const beats = game.messages
    .filter((m) => m.turn >= entry.fromTurn && m.turn <= entry.throughTurn)
    .map((m) => `${m.role === "player" ? "PLAYER" : "NARRATOR"}: ${m.content}`)
    .join("\n\n");

  messages.push({
    role: "system",
    content: [
      settings.journalInstructions.trim(),
      `Reply with ONLY a JSON object: { "lines": [ "…", "…" ] }. At most ${JOURNAL_MAX_LINES} lines. No prose outside the JSON, no code fences.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  messages.push({
    role: "user",
    content: `THE BEATS — Day ${entry.day}, turns ${entry.fromTurn}–${entry.throughTurn}:\n\n${beats}`,
  });

  return messages;
}

/**
 * Parse the writing call's reply into lines.
 *
 * Tolerant about the wrapper (the same `extractFirstJsonObject` the turn block
 * uses) and strict about the contents: anything that is not a non-empty string
 * is dropped, lines are trimmed and length-capped, and the list is cut to
 * `JOURNAL_MAX_LINES`. A reply with no usable line yields none, which leaves
 * the entry with its facts rather than with garbage.
 */
export function parseJournalLines(raw: string): string[] {
  const json = extractFirstJsonObject(raw);
  if (!json) return [];
  const parsed = parseJsonTolerant(json) as { lines?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.lines)) return [];
  return parsed.lines
    .filter((l): l is string => typeof l === "string")
    .map((l) => l.trim().slice(0, JOURNAL_MAX_LINE_CHARS))
    .filter(Boolean)
    .slice(0, JOURNAL_MAX_LINES);
}

/**
 * The injected block lives in `prompt.ts → formatJournalBlock`, beside
 * `buildHistory`, because it is the same kind of thing: a budgeted window over
 * the transcript. It also keeps prompt assembly importing one way, the way
 * every other block formatter here does.
 */
