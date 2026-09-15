import type { GMMove } from "../types";

/**
 * GM Moves (RPG_DESIGN.md → GM Moves) — a player-editable catalog the
 * narrator reaches for on a Fail result, or on a quiet/hesitant turn, instead
 * of freelancing a consequence. Same shape and same catalog-editor pattern as
 * `attributes.ts`'s Specialisation list and `imageTemplates.ts` before it.
 *
 * The shipped defaults are Dungeon World moves, reworded to this app's own
 * voice rather than quoted verbatim, in the same spirit as the steading tag
 * vocabulary `places.ts` already credits — Dungeon World by Sage LaTorra and
 * Adam Koebel, CC BY 3.0. See `.claude/skills/ATTRIBUTION.md`.
 */

function moveId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `move-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** The shipped catalog — reach for one of these on a Fail, or when the player hesitates. */
export function defaultGMMoves(): GMMove[] {
  return [
    {
      id: "unwelcome-truth",
      label: "Reveal an unwelcome truth",
      description: "Something the player believed turns out to be wrong, or worse than they thought.",
    },
    {
      id: "deal-damage",
      label: "Deal damage or harm",
      description: "The consequence lands physically — a wound, a break, something taken by force.",
    },
    {
      id: "separate",
      label: "Separate them",
      description: "Split the party, cut off a retreat, or put distance between the player and what they wanted.",
    },
    {
      id: "spot",
      label: "Put someone in a spot",
      description: "Force an immediate, hard choice — no time to think it through.",
    },
    {
      id: "opportunity-cost",
      label: "Offer an opportunity, with a cost",
      description: "Give them what they want, but attached to a price they have to accept or refuse now.",
    },
    {
      id: "approaching-threat",
      label: "Show signs of an approaching threat",
      description: "Foreshadow danger that hasn't arrived yet — a sound, a smell, a rumor confirmed.",
    },
    {
      id: "turn-move-back",
      label: "Turn their own move back on them",
      description: "Whatever they just tried to do to someone else, happens to them instead.",
    },
    {
      id: "use-worst-outcome",
      label: "Use up their resources",
      description: "Ammunition, supplies, coin, or goodwill runs out sooner than expected.",
    },
  ];
}

/** A new, blank catalog row — the "+ Move" tap. */
export function newGMMove(label = "", description = ""): GMMove {
  return { id: moveId(), label, description };
}

/**
 * Fold whatever storage holds onto a usable catalog — sanitized at READ time.
 * Never empty, matching `attributes.ts → normalizeSpecialisations`'s posture:
 * an empty list would leave the prompt with a heading and nothing under it.
 */
export function normalizeGMMoves(stored: unknown): GMMove[] {
  const list = Array.isArray(stored) ? stored : [];
  const seen = new Set<string>();
  const out: GMMove[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Partial<GMMove>;
    const id = typeof row.id === "string" && row.id.trim() ? row.id : moveId();
    if (seen.has(id)) continue;
    const label = typeof row.label === "string" ? row.label : "";
    if (!label.trim()) continue;
    seen.add(id);
    out.push({ id, label, description: typeof row.description === "string" ? row.description : "" });
  }
  return out.length ? out : defaultGMMoves();
}

/**
 * The `GM MOVES` block — standing context (tier 1), a stable reference
 * toolbox rather than something keyword-gated per turn. `""` when the list is
 * empty, so a game that has cleared its catalog adds nothing to the prompt.
 */
export function formatGMMovesBlock(moves: GMMove[]): string {
  if (!moves.length) return "";
  const lines = moves.map((m) => `- ${m.label}${m.description ? `: ${m.description}` : ""}`);
  return [
    "GM MOVES — reach for one of these to shape a Fail result, or on a quiet/hesitant turn with no clear risky action. A toolbox, not a checklist: use at most one, only when the moment calls for it.",
    ...lines,
  ].join("\n");
}
