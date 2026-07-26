import { useStore } from "../store";
import { useConfirm } from "./useConfirm";

/**
 * Phase 5 reversal controls, revealed from the latest beat (ChatView gates
 * visibility). Regenerate re-rolls the same action for a different narration;
 * Edit opens an inline editor for the narration prose; Undo drops the turn
 * entirely and restores the prior scene. Hidden while streaming and when there
 * is no completed turn to unwind.
 */
export function TurnControls({ onEdit }: { onEdit: () => void }) {
  const hasTurn = useStore((s) => s.game.messages.some((m) => m.role === "narrator"));
  const streaming = useStore((s) => s.streaming);
  const undoLastTurn = useStore((s) => s.undoLastTurn);
  const regenerateLastTurn = useStore((s) => s.regenerateLastTurn);
  const { ask, dialog } = useConfirm();

  if (!hasTurn || streaming) return null;

  const item =
    "min-h-11 flex-1 border-2 border-ink opacity-70 active:bg-ink active:text-paper active:opacity-100";

  return (
    <div className="flex gap-2 text-xs uppercase tracking-widest">
      <button type="button" onClick={regenerateLastTurn} className={item}>
        ↻ Regen
      </button>
      <button type="button" onClick={onEdit} className={item}>
        ✎ Edit
      </button>
      <button
        type="button"
        onClick={() =>
          // Undo is irreversible and sits a thumb-width from Regenerate —
          // confirm so a mis-tap on mobile doesn't silently drop the turn.
          ask(
            {
              title: "Undo the last turn?",
              body: "It drops the turn and everything it changed in the scene. There is no redo.",
              confirmLabel: "Undo turn",
            },
            undoLastTurn,
          )
        }
        className={item}
      >
        ⌫ Undo
      </button>
      {dialog}
    </div>
  );
}
