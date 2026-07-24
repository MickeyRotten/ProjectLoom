import type { Character, GameState, Settings } from "../types";
import {
  computeRelevantGear,
  computeSpotlightSignals,
  formatGearBlock,
  formatSpotlightBlock,
} from "./spotlight";
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

/** In-party members (role "member", inParty), roster + spotlight subject. */
function partyMembers(game: GameState): Character[] {
  return game.characters.filter((c) => c.role === "member" && c.inParty);
}

/** Cheap token estimate (~4 chars/token), enough for windowing. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildMessages(opts: BuildOptions): ChatMessage[] {
  const { settings, game, playerMessage } = opts;
  const budget = opts.historyBudgetTokens ?? DEFAULT_HISTORY_BUDGET;
  const currentTurn = opts.currentTurn ?? game.turnNumber + 1;

  const messages: ChatMessage[] = [];

  // 1–6. Core role + scenario + PC + party + inventory + quests, one block.
  messages.push({ role: "system", content: buildSystemContext(settings, game) });

  // 7. World Notes — lore matched by keyword against the new message + last
  //    few beats (single-category lorebook, titles are implicit keywords).
  const worldNotes = buildWorldNotesBlock(game, playerMessage);
  if (worldNotes) messages.push({ role: "system", content: worldNotes });

  // 8. Spotlight block — deterministic per-member signals + the rule.
  const spotlight = buildSpotlightBlock(settings, game, playerMessage, currentTurn);
  if (spotlight) messages.push({ role: "system", content: spotlight });

  // 8b. Relevant gear — equipped items (PC + party) whose keywords surface in
  //     the action, spotlighted with full name + description so the narrator
  //     uses them. Same keyword machinery + context window as the spotlight.
  const gear = buildGearBlock(game, playerMessage);
  if (gear) messages.push({ role: "system", content: gear });

  // 9. History window: opening narration as the first assistant turn, then a
  //    budget-trimmed tail of recent turns.
  messages.push(...buildHistory(game, budget));

  // 10. Output-protocol instruction (how to emit prose + the <<<LOOM>>> block).
  messages.push({ role: "system", content: buildOutputProtocol(settings) });

  // 11. The player's new message.
  messages.push({ role: "user", content: playerMessage });

  return messages;
}

function buildSystemContext(settings: Settings, game: GameState): string {
  const parts: string[] = [];

  // 1. Core narrator instructions + player custom instructions.
  if (settings.customInstructions.trim()) parts.push(settings.customInstructions.trim());

  // 2. Scenario / premise.
  const s = game.scenario;
  parts.push(`SCENARIO — ${s.title}\n${s.premise}`);

  // 3. PC summary + equipment.
  const pc = game.characters.find((c) => c.role === "pc");
  if (pc) {
    const traits = [
      pc.personality ? `Personality: ${pc.personality}` : "",
      pc.likes ? `Likes: ${pc.likes}` : "",
      pc.dislikes ? `Dislikes: ${pc.dislikes}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const lines = [
      `PLAYER CHARACTER — ${pc.name} (${pc.species})`,
      pc.description,
      traits,
      pc.drive ? `Drive: ${pc.drive}` : "",
      pc.fieldSkill.name
        ? `Field Skill — ${pc.fieldSkill.name}: ${pc.fieldSkill.description}`
        : "",
      formatEquipment(pc.equipment),
    ].filter(Boolean);
    parts.push(lines.join("\n"));
  }

  // 4. Party roster — in-company members with skill + equipment.
  const roster = formatPartyRoster(partyMembers(game));
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
 * personality/likes/dislikes, drive, Field Skill, equipment. Compact but
 * complete enough for the narrator to voice them in character.
 */
export function formatPartyRoster(members: Character[]): string {
  if (!members.length) return "";
  const entries = members.map((m) => {
    const traits = [
      m.personality ? `Personality: ${m.personality}` : "",
      m.likes ? `Likes: ${m.likes}` : "",
      m.dislikes ? `Dislikes: ${m.dislikes}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const lines = [
      `- ${m.name} (${m.species})${m.description ? ` — ${m.description}` : ""}`,
      traits ? `  ${traits}` : "",
      m.drive ? `  Drive: ${m.drive}` : "",
      m.fieldSkill.name
        ? `  Field Skill — ${m.fieldSkill.name}: ${m.fieldSkill.description}`
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
 * Spotlight block (#8) — deterministic per-member signals + the editable rule.
 * Relevance/context folds in the last few beats alongside the new message.
 */
function buildSpotlightBlock(
  settings: Settings,
  game: GameState,
  playerMessage: string,
  currentTurn: number,
): string {
  const party = partyMembers(game);
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
function buildGearBlock(game: GameState, playerMessage: string): string {
  const carriers = game.characters.filter(
    (c) => c.role === "pc" || (c.role === "member" && c.inParty),
  );
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

  const optionsLine = settings.showActionOptions
    ? '- "options": array of 3–4 action strings. ' + optionRule
    : '- "options": OMIT this field entirely — do not suggest actions this turn.';

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
    '- "party": array of { "op": "add|update|remove", "name", "species", "description", "fieldSkill": { "name", "description" } }. Add a member only when they join; remove when they leave.',
    '- "inventory": array of { "op": "add|update|remove", "label", "description", "quantity" }.',
    '- Gold is the permanent currency item in "inventory" — never remove it. When the player gains or spends money, emit { "op": "update", "label": "Gold", "quantity": <new total> }.',
    '- "quests": array of { "op": "add|update|remove", "label", "description", "reward", "status": "active"|"done" }. Update a quest with status "done" when the player completes it.',
    '- "spoke": array of member names you gave a spoken line this turn (a hint only).',
    "",
    'Party dialogue uses the convention `Name: "…"` — the name must be an in-company member.',
    "Never put the JSON before the prose. Never emit more than one block. Never wrap it in code fences.",
  ].join("\n");
}
