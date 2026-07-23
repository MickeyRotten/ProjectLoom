import type { GameState, Settings } from "../types";

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
}

const DEFAULT_HISTORY_BUDGET = 3000;

/** Cheap token estimate (~4 chars/token), enough for windowing. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildMessages(opts: BuildOptions): ChatMessage[] {
  const { settings, game, playerMessage } = opts;
  const budget = opts.historyBudgetTokens ?? DEFAULT_HISTORY_BUDGET;

  const messages: ChatMessage[] = [];

  // 1–6. Core role + scenario + PC + inventory + quests, as one system block.
  messages.push({ role: "system", content: buildSystemContext(settings, game) });

  // 7–8. World Notes + Spotlight block — inserted here in Phase 2/4.

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
    const lines = [
      `PLAYER CHARACTER — ${pc.name} (${pc.species})`,
      pc.description,
      pc.drive ? `Drive: ${pc.drive}` : "",
      pc.fieldSkill.name
        ? `Field Skill — ${pc.fieldSkill.name}: ${pc.fieldSkill.description}`
        : "",
      formatEquipment(pc.equipment),
    ].filter(Boolean);
    parts.push(lines.join("\n"));
  }

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
    if (used + cost > budgetTokens) break;
    used += cost;
    kept.unshift(turns[i]);
  }

  return [opening, ...kept];
}

function buildOutputProtocol(settings: Settings): string {
  const optionRule =
    settings.optionInstructions.trim() ||
    "Offer 3–4 short, concrete next actions.";

  return [
    "OUTPUT PROTOCOL — every turn, emit narration prose FIRST, then exactly one machine block.",
    "The prose is short and punchy. After the prose, on its own lines, emit:",
    "<<<LOOM>>>",
    "{ a single JSON object }",
    "<<<END>>>",
    "",
    "JSON fields (include only what changed this turn):",
    '- "location", "weather", "day": the current scene (strings / number).',
    '- "options": array of 3–4 action strings. ' + optionRule,
    '- "inventory": array of { "op": "add|update|remove", "label", "description", "quantity" }.',
    '- "quests": array of { "op": "add|update|remove", "label", "description", "reward" }.',
    "",
    "Never put the JSON before the prose. Never emit more than one block. Never wrap it in code fences.",
  ].join("\n");
}
