import { useEffect, useState } from "react";
import { useStore } from "../store";
import { pillOutline, pillDanger, pillSolid, filledTextarea } from "./material";

/**
 * Phase 5 reversal controls, revealed from the latest beat (ChatView gates
 * visibility) — Material redesign (DESIGN.md, `Loom Material Redesign.dc.html`).
 * Regenerate re-rolls the same action for a different narration — optionally
 * with a note saying what to do differently; Edit opens an inline editor for
 * the narration prose; Undo drops the turn entirely and restores the prior
 * scene. Hidden while streaming and when there is no completed turn to unwind.
 */
export function TurnControls({ onEdit }: { onEdit: () => void }) {
  const hasTurn = useStore((s) => s.game.messages.some((m) => m.role === "narrator"));
  const streaming = useStore((s) => s.streaming);
  const undoLastTurn = useStore((s) => s.undoLastTurn);
  const regenerateLastTurn = useStore((s) => s.regenerateLastTurn);
  const [regen, setRegen] = useState(false);
  const [undoConfirm, setUndoConfirm] = useState(false);

  if (!hasTurn || streaming) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setRegen(true)} className={pillOutline}>
        ↻ Regen
      </button>
      <button type="button" onClick={onEdit} className={pillOutline}>
        ✎ Edit
      </button>
      {/* Undo is irreversible and sits a thumb-width from Regenerate — confirm
          so a mis-tap on mobile doesn't silently drop the turn. */}
      <button type="button" onClick={() => setUndoConfirm(true)} className={pillDanger}>
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
      {undoConfirm && (
        <UndoConfirmModal
          onClose={() => setUndoConfirm(false)}
          onConfirm={() => {
            setUndoConfirm(false);
            undoLastTurn();
          }}
        />
      )}
    </div>
  );
}

/** Shared scrim + centered rounded-card shell for the two modals below. */
function ModalShell({
  label,
  children,
  onClose,
}: {
  label: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--ink)_55%,transparent)] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="w-full max-w-sm space-y-3 rounded-[16px] bg-paper p-5 font-mono text-ink shadow-xl"
      >
        {children}
      </div>
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

  return (
    <ModalShell label="Regenerate this turn" onClose={onClose}>
      <h2 className="text-[16px] font-semibold">Regenerate turn</h2>
      <textarea
        value={note}
        rows={3}
        autoFocus
        placeholder="What to do differently…"
        onChange={(e) => setNote(e.target.value)}
        className={filledTextarea}
      />
      <p className="text-[12px] leading-relaxed text-[var(--m-text-55)]">
        Your action is re-sent unchanged — the note is direction for the narrator, not
        something your character says, and it isn't kept in the story. Leave it blank for a
        plain re-roll.
      </p>
      <div className="flex gap-2.5 pt-1">
        <button type="button" onClick={() => onRegenerate(note)} className={`flex-1 ${pillSolid}`}>
          Regenerate
        </button>
        <button type="button" onClick={onClose} className={`flex-1 ${pillOutline}`}>
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}

function UndoConfirmModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  return (
    <ModalShell label="Undo the last turn?" onClose={onClose}>
      <h2 className="text-[16px] font-semibold">Undo the last turn?</h2>
      <p className="text-[13px] leading-relaxed text-[var(--m-text-55)]">
        It drops the turn and everything it changed in the scene. There is no redo.
      </p>
      <div className="flex gap-2.5 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 inline-flex min-h-11 items-center justify-center rounded-full bg-danger px-4 text-[13.5px] font-semibold text-[var(--m-danger-ink)]"
        >
          Undo turn
        </button>
        <button type="button" onClick={onClose} className={`flex-1 ${pillOutline}`}>
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}
