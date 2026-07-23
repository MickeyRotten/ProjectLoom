import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { TextField, AreaField, btn, btnSmall } from "./fields";

/**
 * World Notes (DESIGN.md → Menu): the single-category lorebook. Each note's
 * title + comma-separated keywords are matched against recent turns; matches
 * inject into the prompt (see lib/worldNotes.ts). Fully editable in place.
 */
export function WorldNotesScreen() {
  const notes = useStore((s) => s.game.worldNotes);
  const addNote = useStore((s) => s.addNote);
  const updateNote = useStore((s) => s.updateNote);
  const removeNote = useStore((s) => s.removeNote);
  const setScreen = useStore((s) => s.setScreen);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="World Notes" onBack={() => setScreen("menu")} />

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {notes.length === 0 && (
          <p className="uppercase tracking-widest opacity-60">No notes yet.</p>
        )}

        {notes.map((n) => (
          <div key={n.id} className="space-y-3 border-2 border-ink p-3">
            <TextField
              label="Title (implicit keyword)"
              value={n.title}
              placeholder="The Old Well"
              onChange={(v) => updateNote(n.id, { title: v })}
            />
            <TextField
              label="Extra Keywords (comma-separated)"
              value={n.keywords.join(", ")}
              placeholder="well, water, aquifer"
              onChange={(v) =>
                updateNote(n.id, {
                  keywords: v
                    .split(",")
                    .map((k) => k.trim())
                    .filter(Boolean),
                })
              }
            />
            <AreaField
              label="Content"
              value={n.content}
              rows={3}
              placeholder="Lore injected when a keyword is mentioned."
              onChange={(v) => updateNote(n.id, { content: v })}
            />
            <button type="button" onClick={() => removeNote(n.id)} className={btnSmall}>
              Remove
            </button>
          </div>
        ))}

        <button type="button" onClick={addNote} className={`w-full ${btn}`}>
          + Add Note
        </button>
      </div>
    </main>
  );
}
