import { useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { GenerateNoteModal } from "./GenerateNoteModal";
import { TextField, AreaField, ToggleField, btn, btnSmall } from "./fields";
import { useConfirm } from "./useConfirm";

/**
 * World Notes (DESIGN.md → Menu): the single-category lorebook. Each note's
 * title + comma-separated keywords are matched against recent turns; matches
 * inject into the prompt (see lib/worldNotes.ts). A note marked Permanent
 * skips matching and injects on every turn. Fully editable in place.
 *
 * Each note carries a ✦ generate button, the same one the member sheet's fields
 * and the Scenario screen have (`generateNote.ts`) — it writes the whole note,
 * title and keywords included, since a note with no title matches nothing. Like
 * the Scenario screen there is no Edit gate, so an accepted note commits at once.
 *
 * A note also carries the world seed's "letting the seed grow" action
 * (DESIGN.md → World Seed): Promote to Thread / Promote to Fixed Point copies
 * it onto `Scenario.threads`/`.fixedPoints` and removes the note, so a fact
 * that has earned a permanent place in the world seed is not also stated in
 * the lorebook. Deliberately a player-pressed button, never something the
 * narrator's own prose triggers.
 */
export function WorldNotesScreen() {
  const notes = useStore((s) => s.game.worldNotes);
  const addNote = useStore((s) => s.addNote);
  const updateNote = useStore((s) => s.updateNote);
  const removeNote = useStore((s) => s.removeNote);
  const promoteNote = useStore((s) => s.promoteNote);
  const [genNoteId, setGenNoteId] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  const genNote = notes.find((n) => n.id === genNoteId) ?? null;

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="World Notes" />

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
              action={
                <button
                  type="button"
                  aria-label="Generate note"
                  onClick={() => setGenNoteId(n.id)}
                  className="border-2 border-ink px-2 py-1 leading-none active:bg-ink active:text-paper"
                >
                  ✦
                </button>
              }
              onChange={(v) => updateNote(n.id, { title: v })}
            />
            <ToggleField
              label="Permanent"
              hint="Always injected — no keyword needed"
              value={Boolean(n.permanent)}
              onChange={(v) => updateNote(n.id, { permanent: v })}
            />
            {/* Keywords only matter for matched notes — a permanent note is
                injected every turn regardless (they stay stored either way). */}
            {!n.permanent && (
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
            )}
            <AreaField
              label="Content"
              value={n.content}
              rows={3}
              placeholder="Lore injected when a keyword is mentioned."
              onChange={(v) => updateNote(n.id, { content: v })}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  ask(
                    {
                      title: `Promote "${n.title || "Untitled"}" to a Thread?`,
                      body: "Copies its content into the world seed's Open Threads and removes this note.",
                      confirmLabel: "Promote",
                    },
                    () => promoteNote(n.id, "thread", true),
                  )
                }
                className={btnSmall}
              >
                → Thread
              </button>
              <button
                type="button"
                onClick={() =>
                  ask(
                    {
                      title: `Promote "${n.title || "Untitled"}" to a Fixed Point?`,
                      body: "Copies its title and content into the world seed's Fixed Points and removes this note.",
                      confirmLabel: "Promote",
                    },
                    () => promoteNote(n.id, "fixedPoint", true),
                  )
                }
                className={btnSmall}
              >
                → Fixed Point
              </button>
              <button type="button" onClick={() => removeNote(n.id)} className={btnSmall}>
                Remove
              </button>
            </div>
          </div>
        ))}

        <button type="button" onClick={addNote} className={`w-full ${btn}`}>
          + Add Note
        </button>
      </div>
      {dialog}

      {genNote && (
        <GenerateNoteModal
          draft={genNote}
          existing={notes.filter((n) => n.id !== genNote.id)}
          onAccept={(note) =>
            updateNote(genNote.id, {
              title: note.title,
              content: note.content,
              keywords: note.keywords,
            })
          }
          onClose={() => setGenNoteId(null)}
        />
      )}
    </main>
  );
}
