import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Modal, fieldLabel, filledTextarea, pillOutline, pillSolid } from "./material";

/**
 * The ✦ generate modal, shared by every field that has one: ask for ONE field,
 * show what came back, and hand it to the caller only when the player accepts —
 * so a bad roll costs a tap, not the text that was already there.
 *
 * Material redesign (`Loom Material Redesign.dc.html`) — the shared `Modal`
 * scrim/panel shape, same as `EquipModal`.
 *
 * Presentation only. The caller supplies `run`, which is the store action that
 * knows what is being written (a character's Appearance, the scenario's
 * Premise); this knows the shape of the exchange — optional guidance in, a
 * preview back, Use This / Generate Again / Cancel — and nothing about either.
 *
 * Generic over what comes back, because an ITEM is not one string: the pack and
 * the equipment rows generate a label, a description and a count together
 * (`generateItem.ts`), and they preview as one block. A caller whose result is
 * plain text passes no `preview` and gets it rendered as-is.
 *
 * `fieldGenPending` / `fieldGenError` are read straight off the store rather
 * than passed in: one generate modal is open at a time app-wide, which is the
 * same assumption the single-flight guard in the store actions makes.
 */
export function GenerateModal<T = string>({
  label,
  blurb,
  replacing,
  replacingNote,
  options,
  run,
  preview,
  onAccept,
  onClose,
}: {
  /** What is being written, in the player's words — "Appearance", "Premise". */
  label: string;
  /** One line on where the text will be read from. */
  blurb: string;
  /** There is already text here, so accepting overwrites it. */
  replacing: boolean;
  /** What accepting costs, when the caller has something better to say — the
   *  member sheet's accepted text lands in a draft, so it has an undo. */
  replacingNote?: string;
  /** Extra controls under the guidance box — a caller's own toggles (e.g. the
   *  note flow's "use the Scenario"). The caller owns their state and threads it
   *  into `run`; this only finds them a place on the form. */
  options?: React.ReactNode;
  /** Ask the model, with the player's guidance. Null means it failed. */
  run: (hint: string) => Promise<T | null>;
  /** How the result reads in the preview box. Omit for a plain string result. */
  preview?: (result: T) => React.ReactNode;
  onAccept: (result: T) => void;
  onClose: () => void;
}) {
  const pending = useStore((s) => s.fieldGenPending);
  const error = useStore((s) => s.fieldGenError);
  const clearError = useStore((s) => s.clearFieldGenError);
  const [hint, setHint] = useState("");
  const [result, setResult] = useState<T | null>(null);

  // A stale failure from a previous run must not greet the next open.
  useEffect(() => clearError, [clearError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  async function generate() {
    const next = await run(hint);
    if (next) setResult(next);
  }

  function accept() {
    if (result === null) return;
    onAccept(result);
    onClose();
  }

  // Tapping the scrim closes the modal, like every other Material modal — but
  // not mid-generation, matching the Escape guard just above.
  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Modal label={`Generate ${label}`} onClose={close}>
      <h2 className="text-[16px] font-semibold">Generate {label}</h2>
      <p className="text-[13px] leading-relaxed text-[var(--m-text-55)]">{blurb}</p>

      <div className="space-y-1.5">
        <span className={fieldLabel}>Guidance (optional)</span>
        <textarea
          value={hint}
          rows={2}
          placeholder="Anything you want in it…"
          onChange={(e) => setHint(e.target.value)}
          className={filledTextarea}
        />
      </div>

      {options}

      {result !== null && (
        <div className="space-y-1.5">
          <span className={fieldLabel}>{label}</span>
          <div className="whitespace-pre-wrap break-words rounded-[10px] bg-[var(--m-surface)] p-3 text-[13px]">
            {preview ? preview(result) : String(result)}
          </div>
          {replacing && (
            <p className="text-[12px] leading-relaxed text-[var(--m-text-55)]">
              {replacingNote ?? `Replaces the ${label} already written.`}
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      )}

      {result === null ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={pending}
            className={`flex-1 ${pillSolid}`}
          >
            {pending ? "Writing…" : "Generate"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className={`flex-1 ${pillOutline}`}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={accept}
            disabled={pending}
            className={`w-full ${pillSolid}`}
          >
            Use This
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={pending}
              className={`flex-1 ${pillOutline}`}
            >
              {pending ? "Writing…" : "Generate Again"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className={`flex-1 ${pillOutline}`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
