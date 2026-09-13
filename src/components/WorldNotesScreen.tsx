import { useState } from "react";
import { useStore } from "../store";
import { GenerateNoteModal } from "./GenerateNoteModal";
import {
  MaterialHeader,
  Switch,
  card,
  fieldLabel,
  filledInput,
  filledTextarea,
  pillOutline,
} from "./material";
import { useConfirm } from "./useConfirm";

/**
 * World Notes (DESIGN.md → Menu) — Material redesign (`Loom Material
 * Redesign.dc.html`): each note a filled surface card, same shape as
 * Scenario's Factions/Fixed Points rows. The single-category lorebook —
 * each note's title + comma-separated keywords are matched against recent
 * turns; matches inject into the prompt (see lib/worldNotes.ts). A note
 * marked Permanent skips matching and injects on every turn. Fully editable
 * in place — there is deliberately no Edit gate, same as Scenario: this
 * screen writes as you type.
 *
 * Each note carries a ✦ generate button, the same one the member sheet's fields
 * and the Scenario screen have (`generateNote.ts`) — it writes the whole note,
 * title and keywords included, since a note with no title matches nothing.
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
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title="World Notes" back />

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-6">
        {notes.length === 0 && (
          <p className="text-[13px] text-[var(--m-text-55)]">No notes yet.</p>
        )}

        {notes.map((n) => (
          <div key={n.id} className={`space-y-3 ${card}`}>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <span className={fieldLabel}>Title (implicit keyword)</span>
                <input
                  value={n.title}
                  placeholder="The Old Well"
                  onChange={(e) => updateNote(n.id, { title: e.target.value })}
                  className={`font-medium ${filledInput}`}
                />
              </div>
              <button
                type="button"
                aria-label="Generate note"
                onClick={() => setGenNoteId(n.id)}
                className={`${pillOutline} !min-h-9 !px-3`}
              >
                ✦
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--m-surface-strong)] px-3.5 py-2.5">
              <span className="min-w-0">
                <span className="block text-[14px]">Permanent</span>
                <span className="block text-[12px] text-[var(--m-text-55)]">
                  Always injected — no keyword needed
                </span>
              </span>
              <Switch
                on={Boolean(n.permanent)}
                ariaLabel="Permanent"
                onClick={() => updateNote(n.id, { permanent: !n.permanent })}
              />
            </div>

            {/* Keywords only matter for matched notes — a permanent note is
                injected every turn regardless (they stay stored either way). */}
            {!n.permanent && (
              <div className="space-y-1">
                <span className={fieldLabel}>Extra Keywords (comma-separated)</span>
                <input
                  value={n.keywords.join(", ")}
                  placeholder="well, water, aquifer"
                  onChange={(e) =>
                    updateNote(n.id, {
                      keywords: e.target.value
                        .split(",")
                        .map((k) => k.trim())
                        .filter(Boolean),
                    })
                  }
                  className={filledInput}
                />
              </div>
            )}

            <div className="space-y-1">
              <span className={fieldLabel}>Content</span>
              <textarea
                value={n.content}
                rows={3}
                placeholder="Lore injected when a keyword is mentioned."
                onChange={(e) => updateNote(n.id, { content: e.target.value })}
                className={filledTextarea}
              />
            </div>

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
                className={pillOutline}
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
                className={pillOutline}
              >
                → Fixed Point
              </button>
              <button
                type="button"
                onClick={() => removeNote(n.id)}
                className={`ml-auto ${pillOutline}`}
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        <button type="button" onClick={addNote} className={`w-full ${pillOutline}`}>
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
