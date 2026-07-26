import { useEffect, useState } from "react";
import { useStore } from "../store";
import { btn, btnSmall } from "./fields";
import { GEN_FIELD_LABEL, type GenField } from "../lib/generateField";
import type { Character } from "../types";

/**
 * Per-field generate modal (member sheet ✦). Asks the model for ONE field,
 * shows what came back, and hands it to the caller only when the player accepts
 * — so a bad roll costs a tap, not the text that was already there.
 *
 * The character passed in is the sheet's EDIT DRAFT, so the generation reads
 * what the player has typed this session, not what was last saved. Accepting
 * writes back into that draft; Save Changes on the sheet is what commits it.
 */
export function GenerateFieldModal({
  character,
  field,
  onAccept,
  onClose,
}: {
  character: Character;
  field: GenField;
  onAccept: (text: string) => void;
  onClose: () => void;
}) {
  const run = useStore((s) => s.generateField);
  const pending = useStore((s) => s.fieldGenPending);
  const error = useStore((s) => s.fieldGenError);
  const clearError = useStore((s) => s.clearFieldGenError);
  const [hint, setHint] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const label = GEN_FIELD_LABEL[field];
  const replacing = !!character[field].trim();

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
    const text = await run(character, field, hint);
    if (text) setResult(text);
  }

  function accept() {
    if (!result) return;
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
        <p className="text-sm">
          The model writes {label} for {character.name.trim() || "this character"} from their
          sheet — species and sex above all — the scenario, and any world notes they touch.
        </p>

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
            <p className="whitespace-pre-wrap break-words border-2 border-ink p-2 text-sm">
              {result}
            </p>
            {replacing && (
              <p className="text-xs uppercase tracking-widest opacity-60">
                Replaces the {label} on the sheet. Discard Changes still undoes it.
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
