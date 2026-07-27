import { useEffect, useState } from "react";
import { useStore } from "../store";
import { btn, btnSmall } from "./fields";
import { DEFAULT_QUICK_ACTIONS } from "../lib/defaults";
import type { QuickAction } from "../types";

/**
 * The editor behind the ✎ beside the quick actions. Three rows of label +
 * prompt, edited in a local draft so Cancel really cancels, committed to
 * `Settings.quickActions` on Save.
 *
 * Blanking a row is how a shortcut is REMOVED — the composer renders only the
 * rows with both halves written — so nothing here fills a blank field back in
 * with its default. Reset does that on purpose, for all three at once.
 */
export function QuickActionsModal({ onClose }: { onClose: () => void }) {
  const stored = useStore((s) => s.settings.quickActions);
  const updateSettings = useStore((s) => s.updateSettings);
  const [draft, setDraft] = useState<QuickAction[]>(() => stored.map((a) => ({ ...a })));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setRow = (i: number, patch: Partial<QuickAction>) =>
    setDraft((d) => d.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  function save() {
    updateSettings({
      quickActions: draft.map((a) => ({ label: a.label.trim(), input: a.input.trim() })),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit quick actions"
        className="max-h-full w-full max-w-sm space-y-4 overflow-y-auto border-2 border-ink bg-paper p-3 font-mono text-ink"
      >
        <h2 className="uppercase tracking-widest">Quick Actions</h2>
        <p className="text-sm">
          The buttons above the input. The label is what you see; the action is what gets sent as
          your turn, word for word. Clear both to drop a button.
        </p>

        {draft.map((a, i) => (
          <div key={i} className="space-y-2 border-2 border-ink p-3">
            <label className="block space-y-1">
              <span className="block text-sm uppercase tracking-widest">Label</span>
              <input
                value={a.label}
                placeholder={DEFAULT_QUICK_ACTIONS[i]?.label ?? ""}
                onChange={(e) => setRow(i, { label: e.target.value })}
                className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="block text-sm uppercase tracking-widest">Action</span>
              <textarea
                value={a.input}
                rows={2}
                placeholder={DEFAULT_QUICK_ACTIONS[i]?.input ?? ""}
                onChange={(e) => setRow(i, { input: e.target.value })}
                className="w-full resize-y border-2 border-ink bg-paper p-2 focus:outline-none"
              />
            </label>
          </div>
        ))}

        <div className="flex gap-2">
          <button type="button" onClick={save} className={`flex-1 ${btn}`}>
            Save
          </button>
          <button type="button" onClick={onClose} className={`flex-1 ${btn}`}>
            Cancel
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_QUICK_ACTIONS.map((a) => ({ ...a })))}
          className={`w-full ${btnSmall}`}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
