import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Modal, Switch, pillOutline, pillSolid } from "./material";
import { AUTO_FIELDS, type AutoField } from "../lib/autoUpdate";

/**
 * Auto-Update modal (member sheet): pick which sheet fields the model may
 * rewrite, then run one side call. Appearance keeps the character's physical
 * traits and only re-dresses them from their Equipment; Personality and Drive
 * are re-read from the recent beats that mention them by name. Strengths,
 * Flaws and Equipment are never touched — they are listed here so that's
 * visible, not guessed at.
 *
 * Material redesign (`Loom Material Redesign.dc.html`) — the shared `Modal`
 * scrim/panel shape.
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

  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Modal label={`Auto-update ${memberName || "character"} sheet`} onClose={close}>
      <h2 className="text-[16px] font-semibold">Auto-Update Sheet</h2>
      <p className="text-[13px] leading-relaxed text-[var(--m-text-55)]">
        The model rewrites the checked fields for {memberName || "this character"} from the
        sheet and the story so far.
      </p>

      <div className="space-y-2.5">
        {AUTO_FIELDS.map((f) => (
          <div
            key={f}
            className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--m-surface-strong)] px-3.5 py-2.5"
          >
            <span className="min-w-0">
              <span className="block text-[14px]">{LABELS[f]}</span>
              <span className="block text-[12px] text-[var(--m-text-55)]">{HINTS[f]}</span>
            </span>
            <Switch
              on={selected.includes(f)}
              ariaLabel={LABELS[f]}
              onClick={() => toggle(f, !selected.includes(f))}
            />
          </div>
        ))}
      </div>

      <p className="text-[12px] leading-relaxed text-[var(--m-text-55)]">
        Strengths, Flaws and Equipment are never changed.
        {selected.includes("appearance") && (
          <> Regenerate the portrait afterwards to see the new outfit.</>
        )}
      </p>

      {error && (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || selected.length === 0}
          className={`flex-1 ${pillSolid}`}
        >
          {pending ? "Updating…" : "Update"}
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
    </Modal>
  );
}
