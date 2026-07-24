import { useStore, uid } from "../store";
import type { Quest } from "../types";
import { OverlayHeader } from "./OverlayHeader";
import { TextField, AreaField, EditToolbar, btn, btnSmall } from "./fields";
import { useEditBuffer } from "./useEditBuffer";

/**
 * Quests view (DESIGN.md → Quests view): Label · Description · Reward rows with
 * an active/done toggle. Reached from the menu (kept off the 3-button row to
 * preserve the chat layout).
 *
 * Editing is gated behind Edit mode: fields render as read-only text blocks until
 * the player toggles Edit, and changes live in a local draft until Save Changes.
 * Discard Changes (or leaving the screen) reverts and exits edit mode.
 */
export function QuestsScreen() {
  const quests = useStore((s) => s.game.quests);
  const setQuests = useStore((s) => s.setQuests);
  const { editing, draft, setDraft, startEdit, save, discard } = useEditBuffer(quests, setQuests);

  const list = editing ? draft : quests;

  const patch = (id: string, p: Partial<Quest>) =>
    setDraft((d) => d.map((q) => (q.id === id ? { ...q, ...p } : q)));
  const remove = (id: string) => setDraft((d) => d.filter((q) => q.id !== id));
  const add = () =>
    setDraft((d) => [...d, { id: uid(), label: "", description: "", reward: "", status: "active" }]);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Quests" />

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <EditToolbar editing={editing} onEdit={startEdit} onSave={save} onDiscard={discard} />

        {list.length === 0 && (
          <p className="uppercase tracking-widest opacity-60">No quests yet.</p>
        )}

        {list.map((q) => (
          <div key={q.id} className="space-y-3 border-2 border-ink p-3">
            <TextField
              label="Label"
              value={q.label}
              editing={editing}
              onChange={(v) => patch(q.id, { label: v })}
            />
            <AreaField
              label="Description"
              value={q.description}
              rows={2}
              editing={editing}
              onChange={(v) => patch(q.id, { description: v })}
            />
            <TextField
              label="Reward"
              value={q.reward}
              editing={editing}
              onChange={(v) => patch(q.id, { reward: v })}
            />
            <div className="flex flex-wrap gap-2">
              {editing ? (
                <button
                  type="button"
                  onClick={() =>
                    patch(q.id, { status: q.status === "active" ? "done" : "active" })
                  }
                  className={btnSmall}
                >
                  {q.status === "active" ? "Mark Done" : "Reactivate"}
                </button>
              ) : null}
              <span className="self-center text-xs uppercase tracking-widest opacity-70">
                {q.status}
              </span>
              {editing ? (
                <button type="button" onClick={() => remove(q.id)} className={`ml-auto ${btnSmall}`}>
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {editing ? (
          <button type="button" onClick={add} className={`w-full ${btn}`}>
            + Add Quest
          </button>
        ) : null}
      </div>
    </main>
  );
}
