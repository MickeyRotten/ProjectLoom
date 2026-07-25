import { useEffect, useState } from "react";
import { useStore } from "../store";
import { btn, ToggleField } from "./fields";
import { AUTO_FIELDS, type AutoField } from "../lib/autoUpdate";

/**
 * Auto-Update modal (member sheet): pick which sheet fields the model may
 * rewrite, then run one side call. Appearance keeps the character's physical
 * traits and only re-dresses them from their Equipment; Personality and Drive
 * are re-read from the recent beats that mention them by name. Strengths and
 * Equipment are never touched — they are listed here so that's visible, not
 * guessed at.
 */

const HINTS: Record<AutoField, string> = {
  appearance: "Keeps physical traits · re-dresses from Equipment",
  personality: "Re-read from recent beats mentioning them",
  drive: "Re-read from recent beats mentioning them",
};

const LABELS: Record<AutoField, string> = {
  appearance: "Appearance",
  personality: "Personality",
  drive: "Drive",
};

export function AutoUpdateModal({
  memberId,
  memberName,
  onClose,
}: {
  memberId: string;
  memberName: string;
  onClose: () => void;
}) {
  const run = useStore((s) => s.autoUpdateCharacter);
  const pending = useStore((s) => s.autoUpdating);
  const error = useStore((s) => s.autoUpdateError);
  const clearError = useStore((s) => s.clearAutoUpdateError);
  const [selected, setSelected] = useState<AutoField[]>([...AUTO_FIELDS]);

  // A stale failure from a previous run must not greet the next open.
  useEffect(() => clearError, [clearError]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  function toggle(field: AutoField, on: boolean) {
    setSelected((s) => (on ? [...s, field] : s.filter((f) => f !== field)));
  }

  async function submit() {
    if (await run(memberId, selected)) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Auto-update ${memberName || "character"} sheet`}
        className="max-h-full w-full max-w-sm space-y-4 overflow-y-auto border-2 border-ink bg-paper p-3 font-mono text-ink"
      >
        <h2 className="uppercase tracking-widest">Auto-Update Sheet</h2>
        <p className="text-sm">
          The model rewrites the checked fields for {memberName || "this character"} from the
          sheet and the story so far.
        </p>

        <div className="space-y-3">
          {AUTO_FIELDS.map((f) => (
            <ToggleField
              key={f}
              label={LABELS[f]}
              hint={HINTS[f]}
              value={selected.includes(f)}
              onChange={(on) => toggle(f, on)}
            />
          ))}
        </div>

        <p className="text-xs uppercase tracking-widest opacity-60">
          Strengths and Equipment are never changed.
        </p>
        {selected.includes("appearance") && (
          <p className="text-xs uppercase tracking-widest opacity-60">
            Regenerate the portrait afterwards to see the new outfit.
          </p>
        )}

        {error && (
          <p className="border-2 border-ink p-2 text-sm" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending || selected.length === 0}
            className={`flex-1 ${btn}`}
          >
            {pending ? "Updating…" : "Update"}
          </button>
          <button type="button" onClick={onClose} disabled={pending} className={`flex-1 ${btn}`}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
