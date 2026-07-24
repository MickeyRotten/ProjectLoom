import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { TextField, AreaField, btn, btnSmall } from "./fields";

/**
 * Quests view (DESIGN.md → Quests view): Label · Description · Reward rows with
 * an active/done toggle, editable inline. Reached from the menu (kept off the
 * 3-button row to preserve the chat layout).
 */
export function QuestsScreen() {
  const quests = useStore((s) => s.game.quests);
  const addQuest = useStore((s) => s.addQuest);
  const updateQuest = useStore((s) => s.updateQuest);
  const removeQuest = useStore((s) => s.removeQuest);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Quests" />

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {quests.length === 0 && (
          <p className="uppercase tracking-widest opacity-60">No quests yet.</p>
        )}

        {quests.map((q) => (
          <div key={q.id} className="space-y-3 border-2 border-ink p-3">
            <TextField
              label="Label"
              value={q.label}
              onChange={(v) => updateQuest(q.id, { label: v })}
            />
            <AreaField
              label="Description"
              value={q.description}
              rows={2}
              onChange={(v) => updateQuest(q.id, { description: v })}
            />
            <TextField
              label="Reward"
              value={q.reward}
              onChange={(v) => updateQuest(q.id, { reward: v })}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  updateQuest(q.id, { status: q.status === "active" ? "done" : "active" })
                }
                className={btnSmall}
              >
                {q.status === "active" ? "Mark Done" : "Reactivate"}
              </button>
              <span className="self-center text-xs uppercase tracking-widest opacity-70">
                {q.status}
              </span>
              <button
                type="button"
                onClick={() => removeQuest(q.id)}
                className={`ml-auto ${btnSmall}`}
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        <button type="button" onClick={addQuest} className={`w-full ${btn}`}>
          + Add Quest
        </button>
      </div>
    </main>
  );
}
