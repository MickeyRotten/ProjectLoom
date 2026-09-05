import type {
  Character,
  Equipment,
  GameState,
  JournalEntry,
  PartyMember,
  Place,
  Scenario,
  Settings,
} from "../types";
import { phaseOf } from "./clock";
import { equipLine } from "./equip";
import {
  computeRelevantGear,
  computeSpotlightSignals,
  formatGearBlock,
  formatSpotlightBlock,
} from "./spotlight";
import {
  PARTY_LIMIT,
  activeMembers,
  benchedMembers,
  formatIdentity,
  formatTraits,
  npcMembers,
  partedMembers,
  playerCharacter,
  presentMembers,
} from "./roster";
import { formatNpcBlock, matchNpcs } from "./cast";
import {
  findPlace,
  formatCurrentPlaceBlock,
  formatKnownPlacesBlock,
  matchPlaces,
} from "./places";
import { activeTemplate } from "./imageTemplates";
import { matchWorldNotes, formatWorldNotesBlock } from "./worldNotes";
import { formatConditionsBlock, formatStakesBlock, type StakeSignals } from "./stakes";

/**
 * Prompt assembly (DESIGN.md → Prompt assembly, trimmed port of
 * prompt_builder.py::build_prompt). One isolated function returning the
 * OpenRouter messages[] — see `buildMessages` for the tier order and why it is
 * that order.
 *
 * Two rules hold the shape together, and both are easy to break by adding "one
 * more block":
 *
 *  • Every fact is stated ONCE. A mark is in CONDITIONS, not also on the sheet;
 *    a sheet is in the standing context, not also in the roll call. The model
 *    re-states what it is shown twice, and a re-statement is an op, a chip and
 *    a line of transcript.
 *  • Anything the history can contradict is stated AFTER the history. That is
 *    the whole reason the state tier exists, and the reason the pack and the
 *    quest board live there rather than up top with the scenario.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BuildOptions {
  settings: Settings;
  game: GameState;
  /** The adventure's cast — the sheets its roster refers into. */
  characters: Character[];
  /** The player's new message for this turn. */
  playerMessage: string;
  /** Token budget for the rolling history window (approximate). */
  historyBudgetTokens?: number;
  /** Turn about to run; defaults to game.turnNumber + 1 (spotlight timing). */
  currentTurn?: number;
  /**
   * This turn's resolved stakes (`stakes.ts`). Rolled by the CALLER, not here,
   * because the store also records the band on the narrator message — one roll,
   * two consumers. Omitted (or `outcome: null`) injects no outcome block.
   */
  stakes?: StakeSignals;
  /**
   * The player's note on a REGENERATION — "shorter", "let her say no", "less
   * combat". Empty or absent on an ordinary turn, which is every turn that
   * isn't ↻ Regen with something typed into it.
   */
  regenerateNote?: string;
}

/**
 * Fallback history budget. The store passes `Settings.historyBudget`, so this
 * only covers callers that don't (tests, and any future side call).
 */
const DEFAULT_HISTORY_BUDGET = 3000;

/** Bounds for the player-set history budget (Narrator → Memory). */
export const MIN_HISTORY_BUDGET = 500;
export const MAX_HISTORY_BUDGET = 60000;

export function clampHistoryBudget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HISTORY_BUDGET;
  return Math.min(MAX_HISTORY_BUDGET, Math.max(MIN_HISTORY_BUDGET, Math.round(value)));
}

/**
 * How many recent beats every keyword scan folds in alongside the new message
 * — World Notes, NPC sheets, the spotlight and the gear block alike.
 *
 * ONE constant on purpose. All four gates run through `keywordHits` so that
 * "mentioned" means the same thing everywhere; scanning different amounts of
 * text would have given the word two meanings again by the back door.
 */
const CONTEXT_TURNS = 4;

/** Cheap token estimate (~4 chars/token), enough for windowing. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The SCENARIO block — the world seed. Exported because every side call needs
 * the setting's idiom too (`autoUpdate.ts`, `generateField.ts`, `generatePlace.ts`)
 * and three hand-rolled copies had already started to drift apart. Blank when
 * there is nothing to say, so a caller can skip the message entirely.
 *
 * Every field beyond premise is optional and printed only when non-empty, so a
 * scenario that never filled them in (or a save from before they existed) reads
 * exactly as it always did. Always the full text, every turn — DESIGN.md →
 * World Seed: it is short by design, and consistency comes from it being read
 * in full rather than trimmed or keyword-matched.
 */
export function formatScenarioBlock(scenario: Scenario): string {
  if (!scenario.title.trim() && !scenario.premise.trim()) return "";
  return join([
    `SCENARIO — ${scenario.title}\n${scenario.premise}`.trim(),
    scenario.tone.length ? ["Tone:", ...scenario.tone.map((t) => `- ${t}`)].join("\n") : "",
    scenario.physicalLogic.length
      ? ["How this world works:", ...scenario.physicalLogic.map((p) => `- ${p}`)].join("\n")
      : "",
    scenario.factions.length
      ? [
          "Powers already in tension:",
          ...scenario.factions.map((f) => `- ${f.name}${f.description ? `: ${f.description}` : ""}`),
        ].join("\n")
      : "",
    scenario.threads.length
      ? ["Open threads:", ...scenario.threads.map((t) => `- ${t}`)].join("\n")
      : "",
    scenario.dangerCurve.length
      ? ["Danger curve:", ...scenario.dangerCurve.map((d) => `- ${d}`)].join("\n")
      : "",
    scenario.fixedPoints.length
      ? [
          "Already exists:",
          ...scenario.fixedPoints.map((f) => `- ${f.name}${f.description ? `: ${f.description}` : ""}`),
        ].join("\n")
      : "",
  ]);
}

/**
 * The regeneration note block, or "" when there is no note. ↻ Regen without a
 * note is unchanged — same input, same seed, a different roll of the model — so
 * a blank note must add nothing at all to the prompt.
 *
 * The note is deliberately NOT part of the player's message: it is direction to
 * the narrator, not something the character said or did, and folding it into the
 * action would put "make it shorter" in the transcript, in the history window
 * from then on, and — worst — in the seed the stakes roll is drawn from, where
 * it would let a player re-roll a bad outcome by retyping their complaint.
 */
export function formatRegenerateNote(note: string): string {
  const text = note.trim();
  if (!text) return "";
  return [
    "RETELL THIS BEAT — the player has thrown away your previous version of this exact turn and asked for it again, with a note.",
    "Write a DIFFERENT beat for the same action, and follow the note. It is direction from the player, not something their character said or did: never quote it, never narrate it, never have anyone in the scene react to it.",
    text,
  ].join("\n");
}

/** Join blocks into one message, dropping the empty ones. */
function join(blocks: string[]): string {
  return blocks.filter((b) => b.trim()).join("\n\n");
}

/**
 * The prompt, in four tiers plus the turn's own material.
 *
 *  1. STANDING CONTEXT — the narrator, the setting, the sheets. Slow-changing,
 *     and first so it stays a stable prefix from one turn to the next.
 *  2. TURN CONTEXT — the keyword-gated material this action pulled in. Four
 *     derivations of one scan text, so they travel as one message.
 *  3. HISTORY — the opening narration, then a budget-trimmed tail of beats.
 *  4. STATE OF PLAY — what is true right now, stated AFTER the history because
 *     that is what it has to outrank: the beats remember a party that has since
 *     split up, a purse that has since been spent, a place already left.
 *  5. This turn's own facts — the outcome roll, a regeneration note — then the
 *     output protocol, then the action.
 *
 * The tiers run oldest-and-most-general to newest-and-most-specific, so nothing
 * the model reads is ever contradicted by something it read earlier.
 */
export function buildMessages(opts: BuildOptions): ChatMessage[] {
  const { settings, game, characters, playerMessage } = opts;
  const budget = opts.historyBudgetTokens ?? DEFAULT_HISTORY_BUDGET;
  const currentTurn = opts.currentTurn ?? game.turnNumber + 1;
  // Scanned once, read by all four keyword gates below.
  const recent = recentBeats(game, CONTEXT_TURNS);
  const scan = `${playerMessage}\n${recent}`;

  const messages: ChatMessage[] = [];

  // 1. Standing context.
  messages.push({ role: "system", content: buildStandingContext(settings, game, characters) });

  // 2. Turn context: lore the action mentions, the sheets of NPCs it named, the
  //    spotlight, the equipped gear that bears on it. All four are absent on a
  //    quiet turn, and then the message is skipped entirely.
  const features = settings.features;
  const here = features.places ? findPlace(game.places, game.area) : undefined;
  const turnContext = join([
    // NEVER gated. World Notes are lore the PLAYER authored, and they are what
    // is left when every switch below is off — see `FeatureFlags`.
    formatWorldNotesBlock(matchWorldNotes(game.worldNotes, scan)),
    // Places the turn NAMED but is not in. The one the scene is actually in
    // rides in the state tier instead, in full — see `buildStateOfPlay`.
    features.places
      ? formatKnownPlacesBlock(matchPlaces(game.places, scan, here?.id))
      : "",
    features.characters ? buildNpcBlock(game, characters, scan) : "",
    features.spotlight
      ? buildSpotlightBlock(settings, game, characters, playerMessage, recent, currentTurn)
      : "",
    features.gear ? buildGearBlock(game, characters, playerMessage, recent) : "",
  ]);
  if (turnContext) messages.push({ role: "system", content: turnContext });

  // 3. History window: opening narration as the first assistant turn, then a
  //    budget-trimmed tail of recent turns.
  messages.push(...buildHistory(game, budget));

  // 4a. The journal — what already happened, as terse dated lists. Placed after
  //     the history and before the state because it is the older material: the
  //     window holds the last few beats verbatim, and this is the stretch
  //     behind them that the window has already dropped.
  if (features.journal) {
    const journal = formatJournalBlock(game.journal, settings.journalBudget);
    if (journal) messages.push({ role: "system", content: journal });
  }

  // 4b. State of play — scene, party, marks, pack, quests. Every one of them is
  //     re-read from the game each turn and every one is something the history
  //     drifts on, so they carry ONE authority claim between them rather than
  //     five competing ones.
  const state = buildStateOfPlay(settings, game, characters, here);
  if (state) messages.push({ role: "system", content: state });

  // 5a. This turn's outcome band, if the action was a gamble. Its own message:
  //     it is a fact about THIS action and nothing else, and the history is
  //     full of turns that went differently. Gated on the setting so switching
  //     stakes off restores the pure-sandbox behaviour exactly.
  if (features.stakes && opts.stakes) {
    const stakes = formatStakesBlock(opts.stakes, settings.stakesRule);
    if (stakes) messages.push({ role: "system", content: stakes });
  }

  // 5b. The player's note on a regeneration. Last of the per-turn facts, and
  //     kept apart from the state above because it is direction to the narrator
  //     rather than something true in the world. The beat it replaces is not in
  //     the history to be compared against: the turn was unwound before this
  //     call.
  const regen = formatRegenerateNote(opts.regenerateNote ?? "");
  if (regen) messages.push({ role: "system", content: regen });

  // 5c. Output-protocol instruction (how to emit prose + the <<<LOOM>>> block).
  //     Directly before the action, so the shape is the last thing read.
  messages.push({ role: "system", content: buildOutputProtocol(settings) });

  // 5d. The player's new message.
  messages.push({ role: "user", content: playerMessage });

  return messages;
}

/**
 * Tier 1 — the standing context: who is narrating, the setting they are
 * narrating, and the sheets of the people in the scene.
 *
 * Everything here changes slowly (a sheet freezes at creation; the scenario
 * never changes) which is why the volatile halves — the pack, the quest board,
 * the scene, the marks — moved out to `buildStateOfPlay`. They belong after the
 * history, and taking them out leaves this message a stable prefix.
 */
function buildStandingContext(
  settings: Settings,
  game: GameState,
  characters: Character[],
): string {
  const pc = playerCharacter(characters, game.roster);
  return join([
    // The narrator's own instructions, in their own voice — the one block here
    // with no header, because it is not a block of data.
    settings.customInstructions.trim(),
    formatScenarioBlock(game.scenario),
    pc
      ? [
          `PLAYER CHARACTER — ${formatIdentity(pc)}`,
          ...(pc.description ? [pc.description] : []),
          ...formatTraits(pc),
          formatEquipment(pc.equipment),
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    // The members actually in the scene. Benched members get no sheet anywhere:
    // they are the player's, but they are not here, and a sheet is an
    // invitation to write them in.
    settings.features.characters
      ? formatPartyRoster(activeMembers(characters, game.roster))
      : "",
  ]);
}

/**
 * Tier 4 — the state of play: where the scene is, who is standing in it, what
 * marks they carry, what is in the pack, what is still open.
 *
 * All five are re-read from the game every turn, and all five are things the
 * history actively misremembers — a companion who has since left, a purse
 * already spent, a room already walked out of. So they sit together, after the
 * history, under ONE authority line: three blocks each claiming to override the
 * beats read as three arguments, and the model picks one.
 */
function buildStateOfPlay(
  settings: Settings,
  game: GameState,
  characters: Character[],
  here: Place | undefined,
): string {
  const features = settings.features;
  const blocks = join([
    formatSceneBlock(settings, game),
    // The area the location sits inside, in full: what the place is, what is
    // said about it, and which parts of it exist. It belongs in this tier for
    // the same reason the pack does — the beats remember a place already walked
    // out of, and this is what has to outrank them.
    features.places ? formatCurrentPlaceBlock(here) : "",
    features.characters ? buildPartyCompositionBlock(game, characters) : "",
    // The one place a mark is printed. It used to be here AND on every sheet
    // above, which is how a narrator re-stating a condition it had already been
    // shown twice ended up stamping the same chip on four beats in a row.
    features.conditions
      ? formatConditionsBlock(presentMembers(characters, game.roster))
      : "",
    features.inventory ? formatInventoryBlock(game) : "",
    features.quests ? formatQuestBoardBlock(game) : "",
  ]);

  // The authority line speaks for the blocks under it. With every one of them
  // switched off it would be a claim about nothing — so the whole tier goes,
  // and `buildMessages` sends no message for it.
  if (!blocks) return "";
  return join([
    "STATE OF PLAY — true as of this moment, and authoritative. Where anything below disagrees with an earlier beat, what is written here is what is true now.",
    blocks,
  ]);
}

/**
 * The CURRENT SCENE line — where, when, and what the weather is doing.
 *
 * One line built from three independently switchable facts, so a game with the
 * clock off still gets its location. With all three off the line is blank and
 * `join` drops it: nothing states the scene, which is exactly what a narrator
 * running on prose alone should see.
 *
 * Time is a PHASE, never a clock face: a model told "14:30" writes "at half past
 * two" into the prose, which leaks an exact time to a player who is only ever
 * shown the phase — and implies clocks exist in a setting that may not have
 * them.
 */
function formatSceneBlock(settings: Settings, game: GameState): string {
  const features = settings.features;
  const parts = [
    features.location ? `location: ${game.location}` : "",
    features.clock ? `day: ${game.day}` : "",
    features.clock ? `time: ${phaseOf(game.minutes)}` : "",
    features.weather ? `weather: ${game.weather}` : "",
  ].filter(Boolean);
  if (!parts.length) return "";
  return `CURRENT SCENE — ${parts.join("; ")}`;
}

/**
 * The pack. Sits in the state tier rather than the standing context because the
 * output protocol's inventory rules point straight at it — "use the label
 * already in INVENTORY, exactly as written" — and those rules were the whole
 * history window away from the list they name.
 */
function formatInventoryBlock(game: GameState): string {
  if (!game.inventory.length) return "";
  const items = game.inventory.map(
    (it) => `- ${it.label} ×${it.quantity}${it.description ? ` — ${it.description}` : ""}`,
  );
  return ["INVENTORY — what the player is carrying", ...items].join("\n");
}

/** The quest board, open quests only — a finished quest is not a standing fact. */
function formatQuestBoardBlock(game: GameState): string {
  const open = game.quests.filter((q) => q.status === "active");
  if (!open.length) return "";
  const quests = open.map(
    (q) =>
      `- ${q.label}${q.description ? ` — ${q.description}` : ""}${
        q.reward ? ` (reward: ${q.reward})` : ""
      }`,
  );
  return ["ACTIVE QUESTS — open and unfinished", ...quests].join("\n");
}

/**
 * The party roster. One entry per in-company member: identity, the sheet lines
 * `formatTraits` prints for everyone, and their kit. Compact but complete
 * enough for the narrator to voice them in character.
 *
 * No `Condition:` line — a mark is printed once, in the CONDITIONS block down
 * in the state tier, which is also the only place that says how to clear one.
 */
export function formatPartyRoster(members: PartyMember[]): string {
  if (!members.length) return "";
  const entries = members.map((m) => {
    const lines = [
      `- ${formatIdentity(m)}${m.description ? ` — ${m.description}` : ""}`,
      ...formatTraits(m).map((l) => `  ${l}`),
      m.equipment.length ? indent(formatEquipment(m.equipment)) : "",
    ].filter(Boolean);
    return lines.join("\n");
  });
  return `PARTY — in your company (use the PARTY SPOTLIGHT rules below to decide who, if anyone, speaks)\n${entries.join("\n")}`;
}

/** Indent a multi-line block two spaces (roster nesting). */
function indent(block: string): string {
  return block
    .split("\n")
    .map((l) => (l ? `  ${l}` : l))
    .join("\n");
}

/** How many past departures the roll call names before it stops listing. */
const PARTED_LIMIT = 6;

/**
 * The active-party roll call. One compact, deterministic block naming who is
 * travelling with the player RIGHT NOW, plus the companions who left and why.
 */
function buildPartyCompositionBlock(game: GameState, characters: Character[]): string {
  return formatPartyComposition(
    activeMembers(characters, game.roster),
    benchedMembers(characters, game.roster),
    // Newest departures only — an old adventure can accumulate many, and the
    // stale ones are the least likely to still be bleeding into the scene.
    partedMembers(characters, game.roster).slice(-PARTED_LIMIT),
    npcMembers(characters, game.roster).slice(0, NPC_ROLL_CALL_LIMIT),
  );
}

/** How many NPCs the roll call names before it stops listing (names only). */
const NPC_ROLL_CALL_LIMIT = 12;

/**
 * The ACTIVE PARTY block. Deliberately short — the full sheets already rode in
 * the roster block up in the standing context; this one is a membership fact.
 * Every standing that is NOT "in the scene" gets its own explicit negative,
 * because the failure mode is always the same: the history remembers someone
 * the roster has moved on from, and the model keeps walking them alongside the
 * player.
 *
 * It states no authority of its own — the STATE OF PLAY header it sits under
 * carries that for every block in the tier.
 */
export function formatPartyComposition(
  active: PartyMember[],
  benched: PartyMember[] = [],
  parted: PartyMember[] = [],
  npcs: PartyMember[] = [],
): string {
  const names = (members: PartyMember[]) => members.map((m) => m.name).join(", ");
  const lines = [
    "ACTIVE PARTY — THIS TURN",
    active.length
      ? `Travelling with the player (${active.length}/${PARTY_LIMIT}): ${names(active)}`
      : "Travelling with the player (0): nobody — the player is ALONE this turn.",
  ];

  if (benched.length) {
    lines.push(
      `With the party but NOT in this scene: ${names(benched)} — they are elsewhere. Do not voice them, and do not describe them as present.`,
    );
  }

  if (parted.length) {
    const gone = parted.map((m) => `${m.name} (${m.standing})`).join(" · ");
    lines.push(`No longer travelling with the player: ${gone}`);
  }

  if (npcs.length) {
    lines.push(
      `Known in this world, NOT companions: ${names(npcs)} — they live their own lives and only appear where the scene reaches them.`,
    );
  }

  lines.push(
    active.length
      ? "Only these companions are present. Do not voice, move, or describe anyone else as travelling with the player, however recently they appeared in the scene."
      : "No companions are present. Do not voice or act for a companion this turn — anyone in earlier beats has already left.",
  );

  if (parted.some((m) => m.standing === "fallen")) {
    lines.push(
      "A fallen companion is DEAD — never write them back into the scene as present.",
    );
  }

  return lines.join("\n");
}

/**
 * The last `turns` beats as one string — the recent-context half of every
 * keyword scan. Built once per turn and passed down, so the four gates read
 * exactly the same text and no caller can quietly widen its own window.
 */
function recentBeats(game: GameState, turns: number): string {
  // ×2: a turn is a player + narrator message pair.
  return game.messages
    .slice(-turns * 2)
    .map((m) => m.content)
    .join("\n");
}

/**
 * The KNOWN CHARACTERS block — the sheets of NPCs the new message or the recent
 * beats name.
 */
function buildNpcBlock(game: GameState, characters: Character[], scan: string): string {
  const npcs = npcMembers(characters, game.roster);
  if (!npcs.length) return "";
  return formatNpcBlock(matchNpcs(npcs, scan));
}

/**
 * The spotlight block — deterministic per-member signals + the editable rule.
 * Takes the new message and the recent beats separately: the signals weigh
 * being addressed directly more heavily than being relevant to the scene.
 */
function buildSpotlightBlock(
  settings: Settings,
  game: GameState,
  characters: Character[],
  playerMessage: string,
  recent: string,
  currentTurn: number,
): string {
  // Active members only — a benched member owes nobody a line this turn.
  const party = activeMembers(characters, game.roster);
  if (!party.length) return "";
  return formatSpotlightBlock(
    computeSpotlightSignals(playerMessage, recent, party, currentTurn),
    settings.spotlightRule,
  );
}

/**
 * The RELEVANT GEAR block — equipped items on the PC + in-party members whose
 * keywords overlap the new message or the recent beats.
 */
function buildGearBlock(
  game: GameState,
  characters: Character[],
  playerMessage: string,
  recent: string,
): string {
  const carriers = presentMembers(characters, game.roster);
  if (!carriers.some((c) => c.equipment.length)) return "";
  return formatGearBlock(computeRelevantGear(playerMessage, recent, carriers));
}

/** Port of _format_equipment, simplified to {label, description} — no catalog. */
function formatEquipment(equipment: Equipment[]): string {
  if (!equipment.length) return "";
  const items = equipment.map((e) => `  - ${equipLine(e)}`).join("\n");
  return `Equipment:\n${items}`;
}

/**
 * Rolling history window. Always prepends the opening narration as the first
 * assistant turn, then includes as many recent turns as fit the budget (from
 * the newest backward). Port of _trim_to_budget.
 */
export function buildHistory(game: GameState, budgetTokens: number): ChatMessage[] {
  const opening: ChatMessage = {
    role: "assistant",
    content: game.scenario.openingNarration,
  };

  const turns: ChatMessage[] = game.messages.map((m) => ({
    role: m.role === "player" ? "user" : "assistant",
    content: m.content,
  }));

  let used = approxTokens(opening.content);
  const kept: ChatMessage[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = approxTokens(turns[i].content);
    // Always keep the newest turn, even if it alone blows the budget — dropping
    // it would strand the model with only the opening narration.
    if (kept.length && used + cost > budgetTokens) break;
    used += cost;
    kept.unshift(turns[i]);
  }

  return [opening, ...kept];
}

/**
 * How many of the newest entries keep their written lines. Older ones fall back
 * to the `system` lines the client derived from the deltas — the facts reach
 * roughly ten times further back than the prose does, at a tenth of the cost.
 */
export const JOURNAL_PROSE_ENTRIES = 4;

/**
 * The `JOURNAL` block: what already happened, newest entry first, filled until
 * the budget runs out. `buildHistory`'s sibling — a budgeted window over the
 * transcript, just a much older and much denser stretch of it.
 *
 * Deliberately NOT keyword-gated the way World Notes are. Notes are topical, so
 * gating works; a journal is chronological, and gating would hide the entry
 * that mattered. It is bounded by construction instead, and entries past
 * `JOURNAL_PROSE_ENTRIES` decay to their facts before dropping out altogether.
 *
 * Entries stay whole in `GameState` and on the Journal screen regardless: the
 * journal the player reads and the journal the model reads are two products of
 * the same data.
 */
export function formatJournalBlock(entries: JournalEntry[], budgetTokens: number): string {
  if (!entries.length || budgetTokens <= 0) return "";

  const header =
    "JOURNAL — what has already happened on this adventure, newest first. Your own record, kept because only the last few beats are shown to you. Treat it as true. Do not recap it back to the player.";

  let used = approxTokens(header);
  const blocks: string[] = [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const age = entries.length - 1 - i;
    const lines =
      age < JOURNAL_PROSE_ENTRIES
        ? entry.lines
        : entry.lines.filter((l) => l.source === "system");
    if (!lines.length) continue;

    const text = `Day ${entry.day}\n${lines.map((l) => `- ${l.text}`).join("\n")}`;
    const cost = approxTokens(text);
    // Unlike the history window there is no "always keep the newest": an entry
    // is memory, not the turn being answered, and a budget of 0 must mean none.
    if (used + cost > budgetTokens) break;
    used += cost;
    blocks.push(text);
  }

  if (!blocks.length) return "";
  return `${header}\n\n${blocks.join("\n\n")}`;
}

/**
 * The `conditions` field. Its own feature rather than a rider on stakes, which
 * is what it used to be: a COST outcome is the commonest thing that leaves a
 * mark, but it is not the only one, and the player can set a condition by hand
 * on any sheet in a game that never rolls a die.
 */
function conditionLines(settings: Settings): string[] {
  if (!settings.features.conditions) return [];
  // The "a mark is not gear" half points at "inventory" by name. With the pack
  // switched off that channel does not exist, and a rule naming it would teach
  // the field back — the same reason the example is built rather than written.
  const notGear = settings.features.inventory
    ? 'A mark is not gear: what someone carries or wields belongs in "inventory", not in a condition. And a'
    : "A";
  return [
    '- "conditions": array of { "name", "condition" } — a lasting mark the story just left on someone ("left arm in a sling", "hunted by the Watch"). Matches ANYONE by name, the player included. Send "condition": "" to clear one. Marks are not sheet fields; write them freely, and clear them when the story resolves them.',
    `- ${notGear} mark STAYS once written — it is shown back to you every turn under CONDITIONS. Emit one only to set a NEW mark, change the words of an old one, or clear it. Never re-send a mark someone already carries.`,
  ];
}

/**
 * The output protocol — how a turn is emitted, and what may go in the block.
 *
 * Every field bullet below is gated on the feature that owns it. A documented
 * channel is an INVITATION: a model shown `"quests"` will find a quest to open,
 * and `features.ts -> filterBlock` would then throw the op away every turn. So
 * the protocol shrinks with the features rather than being filtered after the
 * fact, and a game with everything off asks for prose and a marker pair.
 */
function buildOutputProtocol(settings: Settings): string {
  const features = settings.features;
  const optionRule =
    settings.optionInstructions.trim() ||
    "Offer 3–4 short, concrete next actions.";

  // Player-editable (Images → Prompt Templates) — this sentence becomes portrait
  // Subjects verbatim, so it's the head of the portrait consistency chain, and
  // it rides the selected image template: a tag-dialect portrait needs a
  // tag-dialect Subject to be built from.
  const appearanceRule =
    activeTemplate(settings).appearanceInstructions.trim() ||
    '"description" is physical appearance only, concrete and visual.';

  // First in the field list and named as required, because it is the field weak
  // models drop most and the one whose absence the player sees immediately. The
  // client salvages what it can (`loomBlock.ts`), but salvage is a net, not a
  // plan.
  const optionsLine = features.options
    ? '- "options": REQUIRED — an array of 3–4 action strings, on EVERY turn without exception. ' +
      optionRule +
      ' The options go in this field and NOWHERE else: never number them in your prose, and never end a beat with "What do you do?" or a list of choices.'
    : // Not documented at all — not even as a field to omit. Naming a field is
      // an invitation, and the salvage paths in `loomBlock.ts` would happily
      // fish options out of the prose for a game that asked for none.
      "";

  // The character-authoring rules (Narrator → Writing Characters). Each is a whole
  // bullet the player owns: blanking one drops the line rather than falling
  // back to a built-in, so "I don't want the model told this" is expressible.
  // The JSON SHAPE around them stays fixed — that half is the parser's
  // contract, not guidance.
  const characterLines = [
    settings.characterCreationInstructions,
    settings.namingInstructions,
    settings.characterUpdateInstructions,
    settings.standingInstructions,
    settings.departureInstructions,
  ]
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => `- ${rule}`);

  // A worked example, which the protocol had none of — fifteen bullets of field
  // documentation and nothing showing the shape assembled. On a weak model one
  // exemplar beats another paragraph of rules, and it is the only place
  // `options` can be shown as what it is: ordinary, and always there.
  //
  // Built from the features rather than written out, because an example is the
  // strongest instruction in the whole protocol: one showing "duration" to a
  // game with the clock off teaches the field back after every rule above has
  // dropped it.
  const exampleFields = [
    features.clock ? '"duration": "scene"' : "",
    features.options
      ? '"options": ["Follow the tracks", "Call out to her", "Back away quietly"]'
      : "",
  ].filter(Boolean);
  const example = exampleFields.length ? `{ ${exampleFields.join(", ")} }` : "{}";

  // Last line of the protocol, which is the last thing read before the player's
  // action — the recency slot, spent on the two failures that cost the player
  // something visible rather than on a list of prohibitions.
  const checklist = features.options
    ? 'Before you finish, check your own output: prose first, then exactly one <<<LOOM>>> … <<<END>>> pair, and "options" inside it with 3–4 strings. A beat that ends without options is an unfinished turn.'
    : "Before you finish, check your own output: prose first, then exactly one <<<LOOM>>> … <<<END>>> pair.";

  // The JSON fields, each gated on the feature that owns it. Order is the one
  // it has always been — options first because it is the field weak models drop
  // most — with the disabled ones simply absent.
  const fields = [
    optionsLine,
    features.weather ? '- "weather": the current scene (string).' : "",
    features.clock
      ? '- "duration": how much time your prose just took, as ONE of these words — "moment" (a blow lands, a door opens), "brief" (a short exchange), "scene" (a conversation, a search of one room), "hour", "hours" (a thorough search, a long negotiation), "halfday" (a journey across the region), "day" (a long haul), "night" (the player sleeps until morning). Always send it. The day and the time of day are counted from this, so guess honestly — never send a number, and never try to set the day yourself.'
      : "",
    features.location
      ? '- "location": the name of the place the scene is in, and NOTHING else — one name, the most specific one. Never join two place names: "Damp Cellar", not "Boars Head Tavern - Damp Cellar"; "Market Square", not "Rodstroke: Market Square". No dash, colon, slash or parent place, and no description.'
      : "",
    features.places
      ? `- "area": the wider place the scene sits ${features.location ? 'INSIDE — the one "location" is a part of' : "in"} — the settlement, the wood, the dungeon, the stretch of road. Send it on EVERY turn. Where an area is already shown to you under CURRENT AREA, repeat that name exactly as written; send a different one only when the player has actually travelled somewhere else, because a name this adventure has not seen before is treated as a new place and written up.`
      : "",
    ...(features.characters
      ? [
          '- "party": array of character ops, each { "op": "add|update|remove", "name", "standing" }. Add a character when they enter the player\'s story; remove when they leave it. "name" is always the name you have been calling them — an op naming somebody new creates them.',
          '- An op may also carry "newName" to RENAME the character "name" resolves to. Their sheet, portrait and standing all stay; only what you call them changes, and the old name keeps working.',
          `- A NEW character's "add" also carries "species", "sex", "description", "personality", "drive", "strengths", "flaws" (all strings) and "equipment": [ { "label", "description" } ] — this is the only op that writes them. ${appearanceRule}`,
          ...characterLines,
        ]
      : []),
    ...conditionLines(settings),
    ...(features.inventory
      ? [
          '- "inventory": array of { "op": "add|update|remove", "label", "description", "quantity" }.',
          '- An inventory "add" means the player TOOK it, in the prose you just wrote — picked it up, was handed it, pulled it free. An object they can merely see is NOT theirs: something lying in a chest, resting on a table, held by someone else, or waiting at the end of an action you are OFFERING them gets no op at all. If "Take the X" is one of your "options", X does not go in the inventory this turn. Wait for them to take it.',
          '- An inventory "add" is also a NEW acquisition. If the label is already listed under INVENTORY above, the player HAS it — do not add it again, however often the scene mentions it. When the count changes, emit "update" with the new "quantity"; when it is gone, "remove". Use the label already in INVENTORY, exactly as written.',
          '- Gold is the permanent currency item in "inventory" — never remove it. Emit a Gold op ONLY on a turn where your prose has money actually change hands — the player is paid, robbed, finds coin, buys something — and then emit { "op": "update", "label": "Gold", "quantity": <new total> }. The total in INVENTORY is already authoritative and is shown back to you every turn: never restate it, and never move it for a beat that says nothing about money.',
        ]
      : []),
    features.quests
      ? '- "quests": array of { "op": "add|update|remove", "label", "description", "reward", "status": "active"|"done" }. Update a quest with status "done" when the player completes it.'
      : "",
    features.notes
      ? '- "notes": array of { "op": "add|update", "title", "content", "keywords": [ … ] } — YOUR OWN MEMORY. Only the last few turns are shown back to you; anything else is forgotten unless you write it down here. Note a place, person, faction, promise, or revelation the moment it matters, and add to a note when you learn more. "keywords" are the words that should bring it back — names and aliases; the title always counts. Keep each note to a couple of factual sentences.'
      : "",
    features.spotlight
      ? '- "spoke": array of member names you gave a spoken line this turn (a hint only).'
      : "",
  ].filter(Boolean);

  // The lines that close the protocol. The first two speak about state the
  // narrator can write and companions it can voice, so both go when there is
  // nothing left to write and nobody left to voice.
  const closing = [
    fields.length
      ? "Every op is a CHANGE your prose just made. The blocks above already tell you what the player has, who travels with them, what marks they carry and what quests are open — none of it needs confirming, and an op that sets something to what it already is will be discarded. When a turn changes nothing, emit an empty object."
      : "There are no fields this turn: emit the marker pair with an empty object between them, every turn, and put everything else in the prose.",
    features.characters
      ? 'Party dialogue uses the convention `Name: "…"` — the name must be an in-company member.'
      : "",
    "Never put the JSON before the prose. Never emit more than one block. Never wrap it in code fences.",
    checklist,
  ].filter(Boolean);

  // The field list with its heading and its trailing blank line, or nothing at
  // all: with every channel off there is no list to head, and a heading over an
  // empty list reads as an instruction whose contents got lost.
  const fieldsBlock = fields.length
    ? ["JSON fields (include only what changed this turn):", ...fields, ""]
    : [];

  return [
    "OUTPUT PROTOCOL — every turn, emit narration prose FIRST, then exactly one machine block.",
    "The prose is short and punchy. After the prose, on its own lines, emit:",
    "<<<LOOM>>>",
    "{ a single JSON object }",
    "<<<END>>>",
    "",
    "A quiet turn that changed nothing in the world still emits the block:",
    "<<<LOOM>>>",
    example,
    "<<<END>>>",
    "",
    ...fieldsBlock,
    ...closing,
  ].join("\n");
}

/**
 * Cooler than narration and cooler than the sheet calls: a repair re-reports a
 * beat that is already written and already on screen. There is nothing here to
 * be creative about, and a hot re-read invents ops the prose never made.
 */
export const BLOCK_REPAIR_TEMPERATURE = 0.2;

/**
 * The repair call: one more request for a turn whose machine block never
 * arrived, or arrived without its action options
 * (`loomBlock.ts → needsBlockRepair`).
 *
 * Takes the turn's OWN messages and appends the response the model actually
 * gave, so the output protocol, the state of play and the beat under repair are
 * all already in context — the instruction below can just point at them instead
 * of restating a thousand tokens of contract.
 *
 * The beat is explicitly declared final. A model told only "that was wrong" will
 * happily rewrite the narration, and the prose has already been streamed to the
 * player and recorded; only the block is in question.
 */
export function buildRepairMessages(
  turn: ChatMessage[],
  raw: string,
  optionsOnly: boolean,
): ChatMessage[] {
  const instruction = optionsOnly
    ? [
        "BLOCK REPAIR — your beat above is accepted and will NOT be rewritten. Its machine block is missing the action options.",
        'Emit ONE <<<LOOM>>> block containing ONLY "options": an array of 3–4 short, concrete actions the player could take right now, following directly from the beat you just wrote.',
        "No prose, no other fields, no explanation, no apology. The block and nothing else.",
      ]
    : [
        "BLOCK REPAIR — your beat above is accepted and will NOT be rewritten, but the machine block that must follow it is missing or unreadable.",
        "Emit that block NOW, exactly as the OUTPUT PROTOCOL above describes it: one <<<LOOM>>> object reporting what the beat you just wrote actually changed, closed with <<<END>>>.",
        "No prose, no commentary, no apology, no code fence. The block and nothing else.",
      ];

  return [
    ...turn,
    { role: "assistant", content: raw },
    { role: "system", content: instruction.join("\n") },
  ];
}
