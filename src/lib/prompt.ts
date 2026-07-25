import type { Character, GameState, PartyMember, Settings } from "../types";
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
  npcMembers,
  partedMembers,
  playerCharacter,
  presentMembers,
} from "./roster";
import { formatNpcBlock, matchNpcs } from "./cast";
import { matchWorldNotes, formatWorldNotesBlock } from "./worldNotes";

/**
 * Prompt assembly (DESIGN.md → Prompt assembly, trimmed port of
 * prompt_builder.py::build_prompt). One isolated function returning the
 * OpenRouter messages[]. Phase 1 covers the PC-only subset; party roster,
 * World Notes, and the spotlight block wire in at Phase 2/4 at the marked
 * insertion points.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BuildOptions {
  settings: Settings;
  game: GameState;
  /** The global character library the game's roster refers into. */
  characters: Character[];
  /** The player's new message for this turn. */
  playerMessage: string;
  /** Token budget for the rolling history window (approximate). */
  historyBudgetTokens?: number;
  /** Turn about to run; defaults to game.turnNumber + 1 (spotlight timing). */
  currentTurn?: number;
}

const DEFAULT_HISTORY_BUDGET = 3000;

/** How many recent beats fold into the spotlight relevance/context scan. */
const SPOTLIGHT_CONTEXT_TURNS = 4;

/** How many recent beats fold into the World Notes keyword scan (#7). */
const WORLD_NOTES_CONTEXT_TURNS = 3;

/** Cheap token estimate (~4 chars/token), enough for windowing. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildMessages(opts: BuildOptions): ChatMessage[] {
  const { settings, game, characters, playerMessage } = opts;
  const budget = opts.historyBudgetTokens ?? DEFAULT_HISTORY_BUDGET;
  const currentTurn = opts.currentTurn ?? game.turnNumber + 1;

  const messages: ChatMessage[] = [];

  // 1–6. Core role + scenario + PC + party + inventory + quests, one block.
  messages.push({ role: "system", content: buildSystemContext(settings, game, characters) });

  // 7. World Notes — lore matched by keyword against the new message + last
  //    few beats (single-category lorebook, titles are implicit keywords).
  const worldNotes = buildWorldNotesBlock(game, playerMessage);
  if (worldNotes) messages.push({ role: "system", content: worldNotes });

  // 7b. Known characters — the sheets of important NPCs / allies the scene has
  //     just named. Keyword-gated like the notes above, so an adventure can
  //     know fifty people without any of them costing a turn they're absent
  //     from. The roll call (#9b) still names them all, every turn.
  const npcs = buildNpcBlock(game, characters, playerMessage);
  if (npcs) messages.push({ role: "system", content: npcs });

  // 8. Spotlight block — deterministic per-member signals + the rule.
  const spotlight = buildSpotlightBlock(settings, game, characters, playerMessage, currentTurn);
  if (spotlight) messages.push({ role: "system", content: spotlight });

  // 8b. Relevant gear — equipped items (PC + party) whose keywords surface in
  //     the action, spotlighted with full name + description so the narrator
  //     uses them. Same keyword machinery + context window as the spotlight.
  const gear = buildGearBlock(game, characters, playerMessage);
  if (gear) messages.push({ role: "system", content: gear });

  // 9. History window: opening narration as the first assistant turn, then a
  //    budget-trimmed tail of recent turns.
  messages.push(...buildHistory(game, budget));

  // 9b. Active-party roll call — the authoritative composition, re-read from
  //     the roster every turn and placed AFTER the history on purpose: the
  //     history outlives membership, so the last thing the model reads before
  //     the action must be who is actually here. Always emitted, even for an
  //     empty party — "you travel alone" is exactly the case history drifts on.
  messages.push({ role: "system", content: buildPartyCompositionBlock(game, characters) });

  // 10. Output-protocol instruction (how to emit prose + the <<<LOOM>>> block).
  messages.push({ role: "system", content: buildOutputProtocol(settings) });

  // 11. The player's new message.
  messages.push({ role: "user", content: playerMessage });

  return messages;
}

function buildSystemContext(
  settings: Settings,
  game: GameState,
  characters: Character[],
): string {
  const parts: string[] = [];

  // 1. Core narrator instructions + player custom instructions.
  if (settings.customInstructions.trim()) parts.push(settings.customInstructions.trim());

  // 2. Scenario / premise.
  const s = game.scenario;
  parts.push(`SCENARIO — ${s.title}\n${s.premise}`);

  // 3. PC summary + equipment.
  const pc = playerCharacter(characters, game.roster);
  if (pc) {
    const lines = [
      `PLAYER CHARACTER — ${pc.name} (${pc.species})`,
      pc.description,
      pc.personality ? `Personality: ${pc.personality}` : "",
      pc.drive ? `Drive: ${pc.drive}` : "",
      pc.strengths.name
        ? `Strengths — ${pc.strengths.name}: ${pc.strengths.description}`
        : "",
      formatEquipment(pc.equipment),
    ].filter(Boolean);
    parts.push(lines.join("\n"));
  }

  // 4. Party roster — the members actually in the scene, with skill +
  //    equipment. Benched members get no sheet anywhere: they are the player's,
  //    but they are not here, and a sheet is an invitation to write them in.
  const roster = formatPartyRoster(activeMembers(characters, game.roster));
  if (roster) parts.push(roster);

  // 5. Inventory (compact).
  if (game.inventory.length) {
    const inv = game.inventory
      .map((it) => `- ${it.label} ×${it.quantity}${it.description ? ` — ${it.description}` : ""}`)
      .join("\n");
    parts.push(`INVENTORY\n${inv}`);
  }

  // 6. Active quests (done omitted).
  const active = game.quests.filter((q) => q.status === "active");
  if (active.length) {
    const qs = active
      .map(
        (q) =>
          `- ${q.label}${q.description ? ` — ${q.description}` : ""}${
            q.reward ? ` (reward: ${q.reward})` : ""
          }`,
      )
      .join("\n");
    parts.push(`ACTIVE QUESTS\n${qs}`);
  }

  // Current scene, so the model stays anchored.
  parts.push(`CURRENT SCENE — location: ${game.location}; day: ${game.day}; weather: ${game.weather}`);

  return parts.join("\n\n");
}

/**
 * Party roster block (#4). One entry per in-company member: identity,
 * personality, drive, Strengths, equipment. Compact but complete enough for
 * the narrator to voice them in character.
 */
export function formatPartyRoster(members: PartyMember[]): string {
  if (!members.length) return "";
  const entries = members.map((m) => {
    const lines = [
      `- ${m.name} (${m.species})${m.description ? ` — ${m.description}` : ""}`,
      m.personality ? `  Personality: ${m.personality}` : "",
      m.drive ? `  Drive: ${m.drive}` : "",
      m.strengths.name
        ? `  Strengths — ${m.strengths.name}: ${m.strengths.description}`
        : "",
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
 * Active-party roll call (#9b). One compact, deterministic block naming who is
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
 * the roster block (#4); this one is a membership fact, stated last. Every
 * standing that is NOT "in the scene" gets its own explicit negative, because
 * the failure mode is always the same: the history remembers someone the
 * roster has moved on from, and the model keeps walking them alongside the
 * player.
 */
export function formatPartyComposition(
  active: PartyMember[],
  benched: PartyMember[] = [],
  parted: PartyMember[] = [],
  npcs: PartyMember[] = [],
): string {
  const names = (members: PartyMember[]) => members.map((m) => m.name).join(", ");
  const lines = [
    "ACTIVE PARTY — THIS TURN (authoritative: it overrides anything earlier beats imply about who is present)",
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
 * World Notes block (#7) — the notes whose title/keywords appear in the new
 * message or the last few beats. Simplified `match_entries`: single category,
 * scan window is the freshest context (where lore is most likely referenced).
 */
function buildWorldNotesBlock(game: GameState, playerMessage: string): string {
  if (!game.worldNotes.length) return "";
  const recent = game.messages
    // ×2: a turn is a player + narrator message pair.
    .slice(-WORLD_NOTES_CONTEXT_TURNS * 2)
    .map((m) => m.content)
    .join("\n");
  const scanText = `${playerMessage}\n${recent}`;
  return formatWorldNotesBlock(matchWorldNotes(game.worldNotes, scanText));
}

/**
 * Known-characters block (#7b) — the sheets of NPCs the new message or the
 * recent beats name. Same scan window as the spotlight: the people the scene
 * is actually about.
 */
function buildNpcBlock(
  game: GameState,
  characters: Character[],
  playerMessage: string,
): string {
  const npcs = npcMembers(characters, game.roster);
  if (!npcs.length) return "";
  return formatNpcBlock(matchNpcs(npcs, scanText(game, playerMessage, SPOTLIGHT_CONTEXT_TURNS)));
}

/** The new message plus the last `turns` beats — the freshest context. */
function scanText(game: GameState, playerMessage: string, turns: number): string {
  // ×2: a turn is a player + narrator message pair.
  const recent = game.messages
    .slice(-turns * 2)
    .map((m) => m.content)
    .join("\n");
  return `${playerMessage}\n${recent}`;
}

/**
 * Spotlight block (#8) — deterministic per-member signals + the editable rule.
 * Relevance/context folds in the last few beats alongside the new message.
 */
function buildSpotlightBlock(
  settings: Settings,
  game: GameState,
  characters: Character[],
  playerMessage: string,
  currentTurn: number,
): string {
  // Active members only — a benched member owes nobody a line this turn.
  const party = activeMembers(characters, game.roster);
  if (!party.length) return "";
  const recentContext = game.messages
    // ×2: a turn is a player + narrator message pair.
    .slice(-SPOTLIGHT_CONTEXT_TURNS * 2)
    .map((m) => m.content)
    .join("\n");
  const signals = computeSpotlightSignals(playerMessage, recentContext, party, currentTurn);
  return formatSpotlightBlock(signals, settings.spotlightRule);
}

/**
 * Relevant-gear block (#8b) — equipped items on the PC + in-party members
 * whose keywords overlap the new message or the recent beats.
 */
function buildGearBlock(
  game: GameState,
  characters: Character[],
  playerMessage: string,
): string {
  const carriers = presentMembers(characters, game.roster);
  if (!carriers.some((c) => c.equipment.length)) return "";
  const recentContext = game.messages
    // ×2: a turn is a player + narrator message pair.
    .slice(-SPOTLIGHT_CONTEXT_TURNS * 2)
    .map((m) => m.content)
    .join("\n");
  return formatGearBlock(computeRelevantGear(playerMessage, recentContext, carriers));
}

/** Port of _format_equipment, simplified to {label, description} — no catalog. */
function formatEquipment(equipment: { label: string; description: string }[]): string {
  if (!equipment.length) return "";
  const items = equipment
    .map((e) => `  - ${e.label}${e.description ? `: ${e.description}` : ""}`)
    .join("\n");
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

function buildOutputProtocol(settings: Settings): string {
  const optionRule =
    settings.optionInstructions.trim() ||
    "Offer 3–4 short, concrete next actions.";

  // Player-editable (Advanced) — this sentence becomes portrait Subjects
  // verbatim, so it's the head of the portrait consistency chain.
  const appearanceRule =
    settings.appearanceInstructions.trim() ||
    '"description" is physical appearance only, concrete and visual.';

  const optionsLine = settings.showActionOptions
    ? '- "options": array of 3–4 action strings. ' + optionRule
    : '- "options": OMIT this field entirely — do not suggest actions this turn.';

  // The character-authoring rules (Advanced → Characters). Each is a whole
  // bullet the player owns: blanking one drops the line rather than falling
  // back to a built-in, so "I don't want the model told this" is expressible.
  // The JSON SHAPE around them stays fixed — that half is the parser's
  // contract, not guidance.
  const characterLines = [
    settings.characterCreationInstructions,
    settings.characterUpdateInstructions,
    settings.standingInstructions,
    settings.departureInstructions,
  ]
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => `- ${rule}`);

  return [
    "OUTPUT PROTOCOL — every turn, emit narration prose FIRST, then exactly one machine block.",
    "The prose is short and punchy. After the prose, on its own lines, emit:",
    "<<<LOOM>>>",
    "{ a single JSON object }",
    "<<<END>>>",
    "",
    "JSON fields (include only what changed this turn):",
    '- "location", "weather", "day": the current scene (strings / number).',
    optionsLine,
    '- "party": array of character ops, each { "op": "add|update|remove", "name", "standing" }. Add a character when they enter the player\'s story; remove when they leave it.',
    `- A NEW character's "add" also carries "species", "description", "personality", "drive" and "strengths": { "name", "description" } — this is the only op that writes them. ${appearanceRule}`,
    ...characterLines,
    '- "inventory": array of { "op": "add|update|remove", "label", "description", "quantity" }.',
    '- Gold is the permanent currency item in "inventory" — never remove it. When the player gains or spends money, emit { "op": "update", "label": "Gold", "quantity": <new total> }.',
    '- "quests": array of { "op": "add|update|remove", "label", "description", "reward", "status": "active"|"done" }. Update a quest with status "done" when the player completes it.',
    '- "spoke": array of member names you gave a spoken line this turn (a hint only).',
    "",
    'Party dialogue uses the convention `Name: "…"` — the name must be an in-company member.',
    "Never put the JSON before the prose. Never emit more than one block. Never wrap it in code fences.",
  ].join("\n");
}
