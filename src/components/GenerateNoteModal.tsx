import { useState } from "react";
import { useStore } from "../store";
import { GenerateModal } from "./GenerateModal";
import { Switch } from "./material";
import type { GeneratedNote } from "../lib/generateNote";
import type { Note } from "../types";

/**
 * The ✦ generate modal for one WORLD NOTE. The exchange itself lives in
 * `GenerateModal`, shared with the member sheet's prose fields, the Scenario
 * screen and the inventory / equipment rows; this binds it to a lorebook entry.
 *
 * The World Notes screen has no Edit gate — it writes as you type — so an
 * accepted note is committed straight away, which the modal says before it
 * lands. The whole note comes back at once (title, content, keywords), so the
 * preview shows all three.
 */
export function GenerateNoteModal({
  draft,
  existing,
  onAccept,
  onClose,
}: {
  /** The note being written, as shown on screen — its typed title is kept. */
  draft: Note;
  /** The other notes, for consistency and de-duplication. */
  existing: Note[];
  onAccept: (note: GeneratedNote) => void;
  onClose: () => void;
}) {
  const run = useStore((s) => s.generateNote);
  const replacing = !!(draft.title.trim() || draft.content.trim() || draft.keywords.length);
  // On by default — the scenario is good grounding — with a box to keep it out
  // for lore meant to sit apart from the adventure's own premise.
  const [useScenario, setUseScenario] = useState(true);

  return (
    <GenerateModal<GeneratedNote>
      label="Note"
      blurb="The model writes a world note — title, lore and keywords — from the lore you have already written and anything you type in as guidance."
      replacing={replacing}
      replacingNote="Replaces this note's title, content and keywords immediately — this screen has no Edit gate. Copy the old text first if you want it back."
      options={
        <div className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--m-surface-strong)] px-3.5 py-2.5">
          <span className="min-w-0">
            <span className="block text-[14px]">Use the Scenario as context</span>
            <span className="block text-[12px] text-[var(--m-text-55)]">
              Ground the note in the adventure's premise and setting
            </span>
          </span>
          <Switch
            on={useScenario}
            ariaLabel="Use the Scenario as context"
            onClick={() => setUseScenario((v) => !v)}
          />
        </div>
      }
      run={(hint) => run(hint, existing, draft, useScenario)}
      preview={(note) => (
        <>
          <span className="font-bold">{note.title}</span>
          {note.content && `\n${note.content}`}
          {note.keywords.length > 0 && (
            <span className="block opacity-60">{`\nKeywords: ${note.keywords.join(", ")}`}</span>
          )}
        </>
      )}
      onAccept={onAccept}
      onClose={onClose}
    />
  );
}
