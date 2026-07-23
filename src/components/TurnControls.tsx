import { useStore } from "../store";

/**
 * Phase 5 reversal controls, tucked under the latest beat (above the AI
 * options). Regenerate re-rolls the same action for a different narration;
 * Undo drops the turn entirely and restores the prior scene. Hidden while
 * streaming and when there is no completed turn to unwind.
 */
export function TurnControls() {
  const hasTurn = useStore((s) => s.game.messages.some((m) => m.role === "narrator"));
  const streaming = useStore((s) => s.streaming);
  const undoLastTurn = useStore((s) => s.undoLastTurn);
  const regenerateLastTurn = useStore((s) => s.regenerateLastTurn);

  if (!hasTurn || streaming) return null;

  return (
    <div className="flex gap-2 text-xs uppercase tracking-widest">
      <button
        type="button"
        onClick={regenerateLastTurn}
        className="flex-1 border-2 border-ink py-1 opacity-70 active:bg-ink active:text-paper active:opacity-100"
      >
        ↻ Regenerate
      </button>
      <button
        type="button"
        onClick={() => {
          // Undo is irreversible and sits a thumb-width from Regenerate — confirm
          // so a mis-tap on mobile doesn't silently drop the turn.
          if (confirm("Undo the last turn? This drops it and its scene changes.")) {
            undoLastTurn();
          }
        }}
        className="flex-1 border-2 border-ink py-1 opacity-70 active:bg-ink active:text-paper active:opacity-100"
      >
        ⌫ Undo
      </button>
    </div>
  );
}
