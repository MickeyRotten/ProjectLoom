import { useEffect, useState } from "react";
import { useStore } from "../store";
import { btn, btnSmall } from "./fields";

/**
 * The ✦ generate modal, shared by every field that has one: ask for ONE field,
 * show what came back, and hand it to the caller only when the player accepts —
 * so a bad roll costs a tap, not the text that was already there.
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Generate ${label}`}
        className="max-h-full w-full max-w-sm space-y-4 overflow-y-auto border-2 border-ink bg-paper p-3 font-mono text-ink"
      >
        <h2 className="uppercase tracking-widest">Generate {label}</h2>
        <p className="text-sm">{blurb}</p>

        <label className="block space-y-1">
          <span className="block uppercase tracking-widest text-sm">Guidance (optional)</span>
          <textarea
            value={hint}
            rows={2}
            placeholder="Anything you want in it…"
            onChange={(e) => setHint(e.target.value)}
            className="w-full resize-y border-2 border-ink bg-paper p-2 focus:outline-none"
          />
        </label>

        {result !== null && (
          <div className="space-y-2">
            <span className="block uppercase tracking-widest text-sm">{label}</span>
            <div className="whitespace-pre-wrap break-words border-2 border-ink p-2 text-sm">
              {preview ? preview(result) : String(result)}
            </div>
            {replacing && (
              <p className="text-xs uppercase tracking-widest opacity-60">
                {replacingNote ?? `Replaces the ${label} already written.`}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="border-2 border-ink p-2 text-sm" role="alert">
            {error}
          </p>
        )}

        {result === null ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={pending}
              className={`flex-1 ${btn}`}
            >
              {pending ? "Writing…" : "Generate"}
            </button>
            <button type="button" onClick={onClose} disabled={pending} className={`flex-1 ${btn}`}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button type="button" onClick={accept} disabled={pending} className={`w-full ${btn}`}>
              Use This
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void generate()}
                disabled={pending}
                className={`flex-1 ${btnSmall}`}
              >
                {pending ? "Writing…" : "Generate Again"}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className={`flex-1 ${btnSmall}`}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
