import { useStore, uid } from "../store";
import type { Quest } from "../types";
import { FeatureOffNotice } from "./FeatureOffNotice";
import {
  MaterialHeader,
  EditPencilButton,
  card,
  filledInput,
  filledTextarea,
  pillOutline,
  pillSolid,
} from "./material";
import { useEditBuffer } from "./useEditBuffer";

/**
 * Quests view (DESIGN.md → Quests view) — Material redesign (`Loom Material
 * Redesign.dc.html`): each quest a filled surface card with a status chip.
 * Reached from the bottom nav, which stays visible under this screen.
 *
 * Editing is gated behind Edit mode — fields render as read-only text until
 * the header pencil toggles Edit, and changes live in a local draft until
 * Save Changes (bottom of the list). Discard Changes (or leaving the screen)
 * reverts and exits edit mode.
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
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title="Quests" action={!editing && <EditPencilButton onClick={startEdit} />} />

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <FeatureOffNotice feature="quests">
          The narrator no longer opens or closes quests, and is not shown the board.
          Everything below is kept, and still yours to edit —
        </FeatureOffNotice>

        {list.length === 0 && (
          <p className="text-[13px] text-[var(--m-text-55)]">No quests yet.</p>
        )}

        {list.map((q) =>
          editing ? (
            <div key={q.id} className={`space-y-2.5 ${card}`}>
              <input
                value={q.label}
                onChange={(e) => patch(q.id, { label: e.target.value })}
                placeholder="Label"
                className={`font-semibold ${filledInput}`}
              />
              <textarea
                value={q.description}
                onChange={(e) => patch(q.id, { description: e.target.value })}
                placeholder="Description"
                rows={2}
                className={`text-[13.5px] ${filledTextarea}`}
              />
              <input
                value={q.reward}
                onChange={(e) => patch(q.id, { reward: e.target.value })}
                placeholder="Reward"
                className={`text-[13.5px] ${filledInput}`}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    patch(q.id, { status: q.status === "active" ? "done" : "active" })
                  }
                  className={pillOutline}
                >
                  {q.status === "active" ? "Mark Done" : "Reactivate"}
                </button>
                <button type="button" onClick={() => remove(q.id)} className={`ml-auto ${pillOutline}`}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div key={q.id} className={card}>
              <div className="flex items-start justify-between gap-2.5">
                <span className="min-w-0 text-[16px] font-semibold">{q.label}</span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] uppercase tracking-wide ${
                    q.status === "active"
                      ? "bg-[color-mix(in_srgb,var(--ink)_14%,transparent)]"
                      : "border border-[var(--m-outline)]"
                  }`}
                >
                  {q.status === "active" ? "Active" : "Done"}
                </span>
              </div>
              {q.description && (
                <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--m-text-55)]">
                  {q.description}
                </p>
              )}
              {q.reward && (
                <p className="mt-2.5 text-[12.5px] text-[var(--m-text-40)]">Reward — {q.reward}</p>
              )}
            </div>
          ),
        )}

        {editing && (
          <>
            <button type="button" onClick={add} className={`w-full ${pillOutline}`}>
              + Add Quest
            </button>
            <div className="flex gap-2.5">
              <button type="button" onClick={discard} className={`flex-1 ${pillOutline}`}>
                Discard
              </button>
              <button type="button" onClick={save} className={`flex-1 ${pillSolid}`}>
                Save changes
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
