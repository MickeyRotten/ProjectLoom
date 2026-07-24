import type { Message } from "../types";
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
    if (d.op === "add") toasts.push(`${d.name} joined the party`);
    else if (d.op === "remove") toasts.push(`${d.name} left the party`);
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

  for (const d of block.quests ?? []) {
    if (!d?.label) continue;
    if (d.op === "add") toasts.push(`Quest started: ${d.label}`);
    else if (d.op === "remove") toasts.push(`Quest removed: ${d.label}`);
    else if (d.op === "update" && d.status === "done")
      toasts.push(`Quest completed: ${d.label}`);
  }

  return toasts;
}
