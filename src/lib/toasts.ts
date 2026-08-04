import type { Message, Standing } from "../types";
import { isGold } from "./defaults";

/**
 * Inline state-change toasts. Each narrator beat that applied a <<<LOOM>>>
 * block gets a row of short chips summarizing what changed — "Navi joined the
 * party", "Quest started: …", "Entered location: …" — derived PURELY from the
 * message's recorded `appliedDeltas` (+ its `reversal` for the pre-turn
 * location). Deriving from the record, not live state, keeps toasts stable in
 * the transcript and correct after undo/regenerate (the message carries its
 * own history).
 */
export function deriveToasts(msg: Message): string[] {
  const block = msg.appliedDeltas;
  if (!block) return [];
  const toasts: string[] = [];

  // Location — only when it actually changed. The reversal snapshot holds the
  // pre-turn location; without one (pre-Phase-5 saves) we can't tell a move
  // from the model restating the scene, so stay quiet.
  if (
    block.location &&
    msg.reversal &&
    block.location.trim() !== msg.reversal.location.trim()
  ) {
    toasts.push(`Entered location: ${block.location.trim()}`);
  }

  for (const d of block.party ?? []) {
    if (!d?.name) continue;
    if (d.op === "remove") {
      toasts.push(`${d.name} left the party`);
      continue;
    }
    // A rename survives reconciliation only when it actually renamed somebody,
    // so the chip is safe to report — and it is the one party change the player
    // cannot see anywhere else in the beat.
    const renamed = d.newName?.trim();
    if (renamed) toasts.push(`${d.name} is now called ${renamed}`);
    // An `add` that isn't a join, and an `update` that moves someone along the
    // ladder, are both real state changes — reporting either as "joined the
    // party" would be a lie the transcript keeps forever. A seat move on the
    // same op names them by the name they now go by.
    const moved = standingToast(renamed || d.name, d.standing);
    if (moved) toasts.push(moved);
    else if (d.op === "add" && !d.newName) toasts.push(`${d.name} joined the party`);
  }

  // Conditions — the marks a COST outcome leaves. Reported as a change, not as
  // state: the chip is tethered to the beat that caused it, and the current
  // mark is always readable on the member sheet.
  for (const d of block.conditions ?? []) {
    if (!d?.name || typeof d.condition !== "string") continue;
    const mark = d.condition.trim();
    toasts.push(mark ? `${d.name}: ${mark}` : `${d.name} recovered`);
  }

  for (const d of block.inventory ?? []) {
    if (!d?.label) continue;
    if (isGold(d.label)) {
      // Gold is the permanent purse: an add is an amount gained, an update is
      // the new total, a remove empties it.
      if (d.op === "add") toasts.push(`+${d.quantity ?? 1} Gold`);
      else if (d.op === "update" && d.quantity !== undefined)
        toasts.push(`Gold: ${d.quantity}`);
      else if (d.op === "remove") toasts.push("Gold: 0");
      continue;
    }
    if (d.op === "add") {
      const qty = d.quantity ?? 1;
      toasts.push(`${d.label} added to inventory${qty > 1 ? ` ×${qty}` : ""}`);
    } else if (d.op === "remove") {
      toasts.push(`${d.label} removed from inventory`);
    } else if (d.op === "update" && d.quantity !== undefined) {
      toasts.push(`${d.label} ×${d.quantity}`);
    }
  }

  // Notes the narrator wrote for itself. Surfaced because they are the long
  // game's memory and the player owns them — a note written wrong is only
  // fixable if you know it happened.
  for (const d of block.notes ?? []) {
    if (!d?.title) continue;
    if (d.op === "remove") toasts.push(`Note removed: ${d.title}`);
    else if (d.op === "update") toasts.push(`Note updated: ${d.title}`);
    else toasts.push(`Noted: ${d.title}`);
  }

  for (const d of block.quests ?? []) {
    if (!d?.label) continue;
    if (d.op === "add") toasts.push(`Quest started: ${d.label}`);
    else if (d.op === "remove") toasts.push(`Quest removed: ${d.label}`);
    else if (d.op === "update" && d.status === "done")
      toasts.push(`Quest completed: ${d.label}`);
  }

  return toasts;
}

/**
 * How a party `add`/`update` that names a standing reads as a chip. Returns ""
 * for `active` and for an omitted standing, so a plain join keeps its own
 * wording and an `update` that only rewrote a sheet stays silent.
 */
function standingToast(name: string, standing?: Standing): string {
  switch (standing) {
    case "benched":
      return `${name} stayed behind`;
    case "npc":
      return `${name} is known here`;
    case "departed":
    case "fallen":
      return `${name} left the party`;
    case "none":
      return `${name} is no longer with the party`;
    default:
      return "";
  }
}
