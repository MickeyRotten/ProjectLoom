import type { PartyMember } from "../types";
import { formatIdentity } from "./roster";
import { keywordHits } from "./worldNotes";

/**
 * The NPC half of the cast in the prompt (DESIGN.md → Prompt assembly #7b).
 *
 * Important NPCs and allies are known to the adventure but do not travel with
 * the player: no party slot, no spotlight, never a `Name: "…"` line the
 * narrator owes anyone. Injecting all of them every turn would grow the prompt
 * with the cast, so their sheets are KEYWORD-GATED exactly like World Notes —
 * a sheet rides along only when the scene actually names them. The roll call
 * still lists their names every turn (`formatPartyComposition`), so the
 * narrator never forgets they exist, only what they are like.
 *
 * Pure + tested: this is the drift guard for NPC injection.
 */

/** How many NPC sheets a single turn may carry. */
export const NPC_LIMIT = 4;

/** Name tokens shorter than this are too collision-prone to match on. */
const MIN_TOKEN = 3;

/**
 * The name forms an NPC answers to: their full name, plus each name token long
 * enough to stand alone ("Mira Aldgate" also answers to "Mira" and "Aldgate").
 */
function nameKeys(npc: PartyMember): string[] {
  const full = npc.name.trim();
  if (!full) return [];
  const tokens = full.split(/\s+/).filter((t) => t.length >= MIN_TOKEN);
  return [full, ...tokens.filter((t) => t !== full)];
}

/**
 * The NPCs the scan text names, in roster order, capped at `limit`. Matching is
 * word-boundary and case-insensitive (`keywordHits`), so "Mira" hits "ask Mira"
 * but not "admiral".
 */
export function matchNpcs(
  npcs: PartyMember[],
  scanText: string,
  limit = NPC_LIMIT,
): PartyMember[] {
  if (!scanText.trim()) return [];
  const matched: PartyMember[] = [];
  for (const npc of npcs) {
    if (matched.length >= limit) break;
    if (nameKeys(npc).some((k) => keywordHits(k, scanText))) matched.push(npc);
  }
  return matched;
}

/**
 * The `KNOWN CHARACTERS` block (#7b) for the matched NPCs, or "" if none.
 * Ends on an explicit negative: without it the model reads a full sheet
 * mid-prompt and starts walking that person alongside the player.
 */
export function formatNpcBlock(npcs: PartyMember[]): string {
  if (!npcs.length) return "";
  const entries = npcs.map((n) => {
    const lines = [
      `- ${formatIdentity(n)}${n.description ? ` — ${n.description}` : ""}`,
      n.personality ? `  Personality: ${n.personality}` : "",
      n.drive ? `  Drive: ${n.drive}` : "",
      n.strengths ? `  Strengths: ${n.strengths}` : "",
      n.flaws ? `  Flaws: ${n.flaws}` : "",
    ].filter(Boolean);
    return lines.join("\n");
  });
  return [
    "KNOWN CHARACTERS — people of this world the scene just named",
    ...entries,
    "These people are NOT in the party. Voice them only where the scene actually reaches them, and never write them as travelling with the player.",
  ].join("\n");
}
