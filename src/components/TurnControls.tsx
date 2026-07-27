import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useConfirm } from "./useConfirm";
import { btn } from "./fields";

/**
 * Phase 5 reversal controls, revealed from the latest beat (ChatView gates
 * visibility). Regenerate re-rolls the same action for a different narration —
 * optionally with a note saying what to do differently; Edit opens an inline
 * editor for the narration prose; Undo drops the turn entirely and restores the
 * prior scene. Hidden while streaming and when there is no completed turn to
 * unwind.
 */
export function TurnControls({ onEdit }: { onEdit: () => void }) {
  const hasTurn = useStore((s) => s.game.messages.some((m) => m.role === "narrator"));
  const streaming = useStore((s) => s.streaming);
  const undoLastTurn = useStore((s) => s.undoLastTurn);
  const regenerateLastTurn = useStore((s) => s.regenerateLastTurn);
  const [regen, setRegen] = useState(false);
  const { ask, dialog } = useConfirm();

  if (!hasTurn || streaming) return null;

  const item =
    "min-h-11 flex-1 border-2 border-ink opacity-70 active:bg-ink active:text-paper active:opacity-100";

  return (
    <div className="flex gap-2 text-xs uppercase tracking-widest">
      <button type="button" onClick={() => setRegen(true)} className={item}>
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
      {regen && (
        <RegenerateModal
          onClose={() => setRegen(false)}
          onRegenerate={(note) => {
            setRegen(false);
            regenerateLastTurn(note);
          }}
        />
      )}
      {dialog}
    </div>
  );
}

/**
 * The note prompt behind ↻ Regen. A bare re-roll only ever gave the model
 * another go at the same prompt, so a beat that went wrong in a specific way —
 * too long, wrong tone, a companion who spoke out of character — could only be
 * fixed by rolling until it happened not to. The note says what to change.
 *
 * Empty is the default and the fast path: Regenerate with nothing typed is
 * exactly the old behaviour, note block and all absent from the prompt
 * (`prompt.ts → formatRegenerateNote`).
 */
function RegenerateModal({
  onRegenerate,
  onClose,
}: {
  onRegenerate: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink p-3 normal-case tracking-normal">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Regenerate this turn"
        className="w-full max-w-sm space-y-4 border-2 border-ink bg-paper p-3 font-mono text-ink"
      >
        <h2 className="uppercase tracking-widest">Regenerate turn</h2>
        <label className="block space-y-1">
          <span className="block text-sm uppercase tracking-widest">Note (optional)</span>
          <textarea
            value={note}
            rows={3}
            autoFocus
            placeholder="What to do differently…"
            onChange={(e) => setNote(e.target.value)}
            className="w-full resize-y border-2 border-ink bg-paper p-2 focus:outline-none"
          />
        </label>
        <p className="text-xs opacity-60">
          Your action is re-sent unchanged — the note is direction for the narrator, not
          something your character says, and it isn't kept in the story. Leave it blank for a
          plain re-roll.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onRegenerate(note)}
            className={`flex-1 ${btn}`}
          >
            Regenerate
          </button>
          <button type="button" onClick={onClose} className={`flex-1 ${btn}`}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
